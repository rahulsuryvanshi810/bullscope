"""Record a 1080p demo video of the BullScope dashboard with a visible mouse cursor (for LinkedIn / README).

    python serve.py                       # in one terminal (live news)
    python scripts/make_demo_video.py     # writes reports/video/bullscope_demo.mp4

Drives headless Chrome like a person would: the pointer glides to tabs and buttons, clicks them, hovers
charts to open tooltips, types into search and scrolls every page. Frames get a drawn cursor, click
ripples, captions and cross-fades, then are encoded as H.264 MP4 at 30 fps (silent; captions tell the story).
"""
import io
import json
import time
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.action_builder import ActionBuilder

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "video" / "bullscope_demo.mp4"
URL = "http://127.0.0.1:8765/"
W, H, FPS = 1920, 1080, 30
ZOOM = 1.25  # page zoom so text stays readable on phones
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_R = "C:/Windows/Fonts/segoeui.ttf"
BLUE = (96, 165, 250)
STATE = {
    "bg": "waves", "range": "1Y", "ovIdx": "NIFTY 50", "stock": "INFY", "newsTab": "Headlines", "newsView": "Magazine", "pf": [],
    "cryDays": 30, "cryCur": "inr",
    "watchlists": [{"name": "My Watchlist", "items": [{"sym": "RELIANCE", "above": 1150, "below": 0}, {"sym": "TCS", "above": 0, "below": 2600},
                                                     {"sym": "TECHM", "above": 0, "below": 0}, {"sym": "BEL", "above": 0, "below": 0}]},
                   {"name": "Long Term", "items": [{"sym": "HDFCBANK", "above": 0, "below": 0}, {"sym": "INFY", "above": 0, "below": 0},
                                                  {"sym": "SUNPHARMA", "above": 0, "below": 0}]},
                   {"name": "Trading", "items": [{"sym": "TATASTEEL", "above": 0, "below": 0}]}, {"name": "Dividend", "items": [{"sym": "ITC", "above": 0, "below": 0}]}],
    "wlActive": 0,
}


# ------------------------------------------------------------------------------------------- drawing
TIP = (2, 2)  # arrow tip inside the cursor image: this pixel sits exactly on the point being clicked


def make_cursor():
    """Standard Windows-style arrow (white fill, thin dark outline, soft shadow), drawn 4x and scaled down."""
    s = 4
    shape = [(0, 0), (0, 17), (4.2, 13.2), (7, 19.5), (9.6, 18.4), (6.9, 12.2), (12, 12.2)]  # ~12 x 20 px, like the real pointer at 125%
    pts = [((x + TIP[0]) * s, (y + TIP[1]) * s) for x, y in shape]
    size = (20 * s, 26 * s)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 1.5 * s, y + 2 * s) for x, y in pts], fill=(0, 0, 0, 90))
    im = shadow.filter(ImageFilter.GaussianBlur(1.6 * s))
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255))
    d.line(pts + [pts[0]], fill=(0, 0, 0, 255), width=int(1.1 * s), joint="curve")
    return im.resize((20, 26), Image.LANCZOS)


CURSOR = make_cursor()


def draw_cursor(img, x, y, ripple=0.0, wheel=False):
    img = img.convert("RGBA")
    if ripple > 0:  # click pulse centred on the arrow tip
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        r = 5 + 15 * ripple
        a = int(190 * (1 - ripple))
        d.ellipse([x - r, y - r, x + r, y + r], outline=BLUE + (a,), width=3, fill=BLUE + (int(a * 0.3),))
        img = Image.alpha_composite(img, layer)
    img.alpha_composite(CURSOR, (int(round(x)) - TIP[0], int(round(y)) - TIP[1]))
    return img


def caption(img, title, sub=None, step=None):
    img = img.convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ft, fs = ImageFont.truetype(FONT_B, 38), ImageFont.truetype(FONT_R, 26)
    tw = d.textlength(title, font=ft)
    sw = d.textlength(sub, font=fs) if sub else 0
    bw, bh = int(max(tw, sw) + 92), (118 if sub else 82)
    x0, y0 = (W - bw) // 2, H - bh - 40
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=22, fill=(9, 14, 28, 232), outline=(59, 130, 246, 210), width=2)
    for k in range(bh - 40):  # blue-to-violet accent bar
        t = k / (bh - 40)
        d.line([(x0 + 18, y0 + 20 + k), (x0 + 24, y0 + 20 + k)], fill=(int(59 + 80 * t), int(130 - 38 * t), int(246), 255))
    d.text((x0 + 46, y0 + 14), title, font=ft, fill=(240, 246, 255, 255))
    if sub:
        d.text((x0 + 46, y0 + 66), sub, font=fs, fill=(170, 184, 206, 255))
    if step:
        f2 = ImageFont.truetype(FONT_B, 22)
        lbl = f"  {step}  "
        lw = d.textlength(lbl, font=f2)
        d.rounded_rectangle([W - lw - 40, H - 74, W - 28, H - 36], radius=12, fill=(9, 14, 28, 220), outline=(59, 130, 246, 180), width=2)
        d.text((W - lw - 34, H - 69), lbl, font=f2, fill=BLUE + (255,))
    return Image.alpha_composite(img, layer)


# ------------------------------------------------------------------------------------------- film
class Film:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.w = imageio.get_writer(str(path), fps=FPS, codec="libx264", quality=None, macro_block_size=8, pixelformat="yuv420p",
                                    ffmpeg_params=["-crf", "22", "-preset", "slow", "-movflags", "+faststart"])
        self.last, self.frames = None, 0

    def put(self, img, n=1):
        arr = np.asarray(img.convert("RGB"))
        for _ in range(n):
            self.w.append_data(arr)
        self.last, self.frames = img, self.frames + n

    def fade_to(self, img, n=10):
        if self.last is not None:
            for k in range(1, n + 1):
                self.put(Image.blend(self.last.convert("RGB"), img.convert("RGB"), k / (n + 1)))
        self.put(img)

    def close(self):
        self.w.close()


class Director:
    """Moves the real pointer, scrolls, clicks and types while drawing everything into the film."""

    def __init__(self, drv, film):
        self.d, self.f = drv, film
        self.x, self.y = W * 0.55, H * 0.45
        self.cap = (None, None, None)

    def shot(self):
        return Image.open(io.BytesIO(self.d.get_screenshot_as_png())).convert("RGB").resize((W, H))

    def frame(self, base, n=1, ripple=0.0, wheel=False):
        img = draw_cursor(base, self.x, self.y, ripple, wheel)
        if self.cap[0]:
            img = caption(img, *self.cap)
        self.f.put(img, n)

    def say(self, title, sub=None, step=None):
        self.cap = (title, sub, step)

    def pointer(self, x, y):
        cx = int(min(max(x, 2), W - 4) / ZOOM)
        cy = int(min(max(y, 2), H - 4) / ZOOM)
        try:
            ab = ActionBuilder(self.d)
            ab.pointer_action.move_to_location(cx, cy)
            ab.perform()
        except Exception:  # a pointer move is cosmetic; never let it stop the recording
            pass

    def rect(self, sel):
        r = self.d.execute_script(f"const e=document.querySelector({json.dumps(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.left,b.top,b.width,b.height];")
        return None if r is None else [v * ZOOM for v in r]

    def glide(self, x, y, seconds=0.7):
        base = self.shot()
        n = max(6, int(seconds * FPS))
        x0, y0 = self.x, self.y
        for k in range(1, n + 1):
            e = 0.5 - 0.5 * np.cos(np.pi * k / n)
            self.x, self.y = x0 + (x - x0) * e, y0 + (y - y0) * e
            self.frame(base)
        self.pointer(x, y)  # real hover: tooltips and hover styles appear
        time.sleep(0.35)
        self.frame(self.shot(), 4)

    def ensure_visible(self, sel, top=0.22):
        r = self.rect(sel)
        if r and (r[1] < 90 or r[1] + r[3] > H - 170):
            self.scroll_by(r[1] - H * top, max(0.6, min(1.4, abs(r[1] - H * top) / 1400)))

    def click(self, sel, wait=1.2, x_frac=0.5, y_frac=0.5):
        self.ensure_visible(sel)
        r = self.rect(sel)
        if not r:
            return
        tx, ty = r[0] + r[2] * x_frac, r[1] + r[3] * y_frac
        tx, ty = min(max(tx, 4), W - 6), min(max(ty, 4), H - 6)
        self.glide(tx, ty)
        hit = self.d.execute_script(f"const t=document.querySelector({json.dumps(sel)}), e=document.elementFromPoint({tx / ZOOM},{ty / ZOOM}); return !!(t && e && (t===e || t.contains(e) || e.contains(t)));")
        print(("OK  " if hit else "MISS") + f" click {sel} at ({tx:.0f},{ty:.0f})")
        base = self.shot()
        for k in range(1, 9):
            self.frame(base, ripple=k / 9)
        try:
            ActionChains(self.d).click().perform()
        except Exception:
            self.d.execute_script(f"document.querySelector({json.dumps(sel)}).click()")
        time.sleep(wait)
        self.frame(self.shot(), 3)

    def hover(self, sel, x_frac=0.5, y_frac=0.5, hold=1.2):
        self.ensure_visible(sel, 0.25)
        r = self.rect(sel)
        if r:
            self.glide(min(max(r[0] + r[2] * x_frac, 4), W - 6), min(max(r[1] + r[3] * y_frac, 60), H - 180))
            self.frame(self.shot(), int(hold * FPS))

    def scroll_by(self, dy_px, seconds=1.2):
        """Eased wheel-style scroll; dy in screen pixels."""
        y0 = self.d.execute_script("return window.scrollY")
        target = y0 + dy_px / ZOOM
        n = max(8, int(seconds * FPS / 2))
        for k in range(1, n + 1):
            e = 0.5 - 0.5 * np.cos(np.pi * k / n)
            self.d.execute_script(f"window.scrollTo(0,{int(y0 + (target - y0) * e)})")
            self.frame(self.shot(), 2)
        self.frame(self.shot(), 2)

    def scroll_to(self, sel, top=0.16, seconds=1.3):
        r = self.rect(sel)
        if r:
            self.scroll_by(r[1] - H * top, seconds)

    def hold(self, seconds):
        self.frame(self.shot(), int(seconds * FPS))

    def type(self, text, per_char=4):
        for ch in text:
            ActionChains(self.d).send_keys(ch).perform()
            time.sleep(0.12)
            self.frame(self.shot(), per_char)


def card_html(inner):
    cw, ch = int(W / ZOOM), int(H / ZOOM)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
    body{{margin:0;width:{cw}px;height:{ch}px;display:grid;place-items:center;font-family:'Segoe UI',system-ui,sans-serif;color:#e8edf5;overflow:hidden;
      background:radial-gradient(900px 600px at 85% 0%,rgba(59,130,246,.35),transparent 60%),radial-gradient(800px 600px at 0% 100%,rgba(139,92,246,.30),transparent 60%),#0a0f1c}}
    body:before{{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px);background-size:44px 44px;
      -webkit-mask-image:radial-gradient(ellipse 80% 70% at 50% 40%,#000 30%,transparent 85%)}}
    .c{{text-align:center;position:relative;zoom:.8}} h1{{font-size:96px;margin:18px 0 6px;letter-spacing:-2px;background:linear-gradient(90deg,#bfdbfe,#60a5fa 50%,#a78bfa);-webkit-background-clip:text;color:transparent}}
    h2{{font-size:40px;font-weight:600;margin:0;color:#cbd5e1}} p{{font-size:30px;color:#94a3b8;margin:14px 0 0}} .g{{color:#93c5fd;font-weight:700}}
    .pill{{display:inline-block;margin:10px 8px 0;padding:12px 24px;border:2px solid rgba(96,165,250,.5);border-radius:999px;font-size:28px;background:rgba(17,26,43,.75)}}
    img.logo{{filter:drop-shadow(0 10px 30px rgba(59,130,246,.5))}}</style></head><body><div class="c">{inner}</div></body></html>"""


def show_card(dr, inner, seconds):
    p = ROOT / "reports" / "video" / "_card.html"
    p.write_text(card_html(inner), encoding="utf-8")
    dr.d.get(p.as_uri())
    time.sleep(0.8)
    dr.cap = (None, None, None)
    dr.f.fade_to(dr.shot(), 12)
    dr.f.put(dr.f.last, int(seconds * FPS))


def nav(dr, page, wait=2.5):
    dr.click(f'#nav a[data-page="{page}"]', wait=wait)


def main():
    o = Options()
    for a in ["--headless=new", f"--window-size={int(W / ZOOM)},{int(H / ZOOM)}", f"--force-device-scale-factor={ZOOM}", "--hide-scrollbars",
              "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required"]:
        o.add_argument(a)
    drv = webdriver.Chrome(options=o)
    film = Film(OUT)
    dr = Director(drv, film)
    T = 10
    try:
        drv.get(URL)
        drv.execute_script("localStorage.setItem('dsp-state', arguments[0]); localStorage.setItem('dsp-theme', 'dark');", json.dumps(STATE))
        show_card(dr, f'<img class="logo" src="{URL}logo.svg" width="150"><h1>BullScope</h1><h2>Indian Stock Market · F&amp;O · Mutual Fund &amp; Crypto Analytics</h2>'
                      f'<p>Built by <span class="g">Rahul Suryavanshi</span></p>', 3.5)

        # 1. overview
        drv.get(URL + "#overview")
        time.sleep(6)
        dr.say("Market Pulse at a glance", "NIFTY 50, market mood from breadth & trend, India VIX fear gauge", f"1 / {T}")
        dr.f.fade_to(caption(draw_cursor(dr.shot(), dr.x, dr.y), *dr.cap), 10)
        dr.hover("#ovHero", 0.25, 0.65, 1.4)
        dr.hover("#ovTiles .tile:nth-child(2)", 0.5, 0.5, 0.8)
        dr.say("Index chart & sector performance", "Pick any period: 1M, 3M, 1Y, 3Y or custom dates", f"1 / {T}")
        dr.scroll_to("#ovIdxChart", 0.28)
        dr.hover("#ovIdxChart", 0.62, 0.5, 1.4)
        dr.say("Heatmap of all NIFTY 50 stocks", "Box size = market cap · colour = return · hover for details", f"1 / {T}")
        dr.scroll_to("#ovHeat", 0.18)
        dr.hover("#ovHeat", 0.18, 0.35, 1.6)
        dr.say("Multiple watchlists with price alerts", "My Watchlist · Long Term · Trading · Dividend — or create your own", f"1 / {T}")
        dr.scroll_to("#ovWatch", 0.2)
        dr.click('#ovWatch .wl-tab[data-wl="1"]', 0.8)
        dr.hold(1.0)
        dr.click('#ovWatch .wl-tab[data-wl="0"]', 0.8)
        dr.say("Seasonality & 52-week highs / lows", "Which months are usually good or bad for the market", f"1 / {T}")
        dr.scroll_to("#ovSeason", 0.2)
        dr.hover("#ovSeason", 0.6, 0.45, 1.4)

        # 2. search -> stock
        dr.say("Global search  (Ctrl + K)", "Stocks, 38,000+ mutual funds, coins, headlines and pages in one box", f"2 / {T}")
        drv.execute_script("window.scrollTo(0,0)")
        dr.click("#gsOpen", 0.6)
        dr.type("infosys")
        time.sleep(0.6)
        dr.hold(1.2)
        dr.click("#gsList .gs-item", 3)
        dr.say("Stock Explorer", "Candles, moving averages, volume, RSI · NSE vs BSE price", f"3 / {T}")
        dr.hover("#stCandle", 0.72, 0.35, 1.8)
        dr.say("Fundamentals, shareholding & signals", "Technical score and ML probability, shown with their honest back-test", f"3 / {T}")
        dr.scroll_to("#stFund", 0.2)
        dr.hold(1.6)
        dr.say("60-day Monte Carlo outlook & company news", "3,000 simulated paths from real daily returns", f"3 / {T}")
        dr.scroll_to("#stMC", 0.2)
        dr.hover("#stMC", 0.85, 0.5, 1.6)

        # 4. compare
        dr.say("Compare up to 5 stocks, indices or funds", "Growth of ₹100, correlation heatmap, drawdown and risk table", f"4 / {T}")
        nav(dr, "compare", 2.5)
        dr.hover("#cmpGrowth", 0.7, 0.45, 1.6)
        dr.scroll_to("#cmpTable", 0.25)
        dr.hold(1.4)

        # 5. news
        dr.say("Live market news from 90+ publishers", "Top stories with photos · tone check · companies & coins tagged", f"5 / {T}")
        nav(dr, "news", 3.5)
        dr.hold(1.0)
        dr.scroll_to("#newsTopWrap", 0.12)
        dr.hover("#newsTop .ts-wrap:nth-child(2)", 0.5, 0.5, 1.2)
        dr.scroll_by(-2000, 0.8)
        dr.say("Market videos · For you · Saved", "CNBC-TV18, Moneycontrol, NDTV Profit, CoinDesk… played inside the app", f"5 / {T}")
        dr.click('#newsTabs [data-tab="Videos"]', 2.5)
        dr.hover("#vidGrid .vid:nth-child(2)", 0.5, 0.4, 1.4)
        dr.click('#newsTabs [data-tab="Headlines"]', 1.2)

        # 6. crypto
        dr.say("Live crypto & Bitcoin", "Top 25 coins in ₹ or $, price charts, dominance, Fear & Greed index", f"6 / {T}")
        nav(dr, "crypto", 6)
        dr.click('#cryDays button[data-v="1Y"]', 3)
        dr.hover("#cryChart", 0.75, 0.4, 1.4)
        dr.scroll_to("#cryTable", 0.18)
        dr.hold(1.4)

        # 7. F&O
        dr.say("F&O option chain", "Greeks, open interest, PCR, max pain, IV smile", f"7 / {T}")
        nav(dr, "fno", 3)
        dr.hover("#fnoOI", 0.55, 0.45, 1.2)
        dr.say("Strategy payoff builder", "Click any premium to add a leg — max profit, loss, breakevens, chance of profit", f"7 / {T}")
        dr.scroll_to("#fnoChain", 0.12)
        dr.click("#fnoChain tr.atm .ltp", 1.2)
        dr.scroll_to("#payoff", 0.35)
        dr.hover("#payoff", 0.62, 0.5, 1.6)

        # 8. funds + holdings
        dr.say("80 mutual funds, scored 0–100", "Search any of 38,000 AMFI funds · returns, Sharpe, drawdown, SIP XIRR", f"8 / {T}")
        nav(dr, "funds", 3)
        dr.click("#mfSearch", 0.4)
        dr.type("parag parikh", 3)
        time.sleep(2.2)
        dr.hold(1.0)
        drv.execute_script("el('mfSearch').value=''; el('mfResults').innerHTML='';")
        dr.scroll_to("#mfTable", 0.14)
        dr.hold(1.2)
        dr.click("#mfTable tbody tr:nth-child(2)", 2.0)
        dr.scroll_to("#mfTiles", 0.12, 0.8)
        dr.hover("#mfGrowth", 0.7, 0.5, 1.4)
        dr.say("Which fund owns which company", "Weights, stake in each company, what funds bought or sold this month", f"8 / {T}")
        nav(dr, "holdings", 2.5)
        dr.click('#hMode button[data-v="By company"]', 1.5)
        dr.hold(1.4)

        # 9. portfolio
        dr.say("My Portfolio", "Import from Zerodha, Groww, Upstox, Angel One — or add holdings by hand", f"9 / {T}")
        nav(dr, "portfolio", 2.5)
        dr.click("#pfSample", 2.5)
        dr.scroll_to("#pfTiles", 0.12)
        dr.hold(1.6)
        dr.say("12-month prediction & health check", "Replays real market days · warns about concentration and sell signals", f"9 / {T}")
        dr.scroll_to("#pfPred", 0.3)
        dr.hover("#pfPred", 0.8, 0.4, 1.8)

        # 10. advisor + goal planner
        dr.say("Advisor & goal planner", "Risk profile → model portfolio → monthly SIP needed for your goal", f"10 / {T}")
        nav(dr, "advisor", 2.5)
        dr.hold(1.0)
        dr.scroll_to("#goalTiles", 0.3)
        dr.hover("#goalChart", 0.75, 0.5, 1.8)

        # themes
        dr.say("7 themes · light & dark · works on phones", "Pick a background with the palette button")
        nav(dr, "overview", 2.5)
        drv.execute_script("window.scrollTo(0,0)")
        dr.click("#bgBtn", 0.6)
        for bg in ["candles", "network", "waves"]:
            dr.click(f'#bgMenu [data-bg="{bg}"]', 0.9)
        dr.click("#themeBtn", 1.2)
        dr.hold(1.0)
        dr.click("#themeBtn", 1.0)

        show_card(dr, '<h2 style="font-size:46px">Built with</h2><div style="margin-top:22px">' + "".join(
            f'<span class="pill">{x}</span>' for x in ["Python", "pandas", "scikit-learn", "ECharts", "Power BI · 77 DAX measures", "Tableau",
                                                       "GitHub Actions", "Real NSE / BSE &amp; AMFI data"]) + "</div>", 3.2)
        show_card(dr, f'<img class="logo" src="{URL}logo.svg" width="110"><h1 style="font-size:78px">Try it live</h1>'
                      '<p style="font-size:38px"><span class="g">rahulsuryvanshi810.github.io/bullscope</span></p>'
                      '<p>Code: github.com/rahulsuryvanshi810/bullscope</p>'
                      '<p style="font-size:22px;margin-top:40px;color:#64748b">Educational project · not investment advice</p>', 4.5)
    finally:
        film.close()
        drv.quit()
        (ROOT / "reports" / "video" / "_card.html").unlink(missing_ok=True)
    print(f"{OUT} · {film.frames / FPS:.1f} s · {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
