"""Record a 1080p demo video of the BullScope dashboard (for LinkedIn / README).

    python serve.py                       # in one terminal (live news)
    python scripts/make_demo_video.py     # writes reports/video/bullscope_demo.mp4

Drives headless Chrome through the main pages, captures frames, adds title cards, captions and
cross-fades, and encodes H.264 MP4 at 30 fps (LinkedIn-friendly, silent, captions carry the story).
"""
import io
import json
import time
from pathlib import Path

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "video" / "bullscope_demo.mp4"
URL = "http://127.0.0.1:8765/"
W, H, FPS = 1920, 1080, 30
ZOOM = 1.25  # record at 125% so text stays readable on phones
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_R = "C:/Windows/Fonts/segoeui.ttf"
GOLD = (233, 199, 102)

SAMPLE_STATE = {
    "bg": "gold", "range": "1Y", "ovIdx": "NIFTY 50", "stock": "INFY", "newsTab": "Headlines", "newsView": "Magazine",
    "pf": [{"t": "S", "id": "RELIANCE", "q": 25, "p": 1320}, {"t": "S", "id": "HDFCBANK", "q": 40, "p": 820},
           {"t": "S", "id": "INFY", "q": 20, "p": 1480}, {"t": "S", "id": "TCS", "q": 6, "p": 3300},
           {"t": "S", "id": "ITC", "q": 120, "p": 410}, {"t": "S", "id": "SUNPHARMA", "q": 15, "p": 1650},
           {"t": "F", "id": 122639, "q": 900, "p": 72}, {"t": "F", "id": 118989, "q": 250, "p": 170}, {"t": "F", "id": 119091, "q": 4, "p": 4900}],
    "watchlists": [{"name": "My Watchlist", "items": [{"sym": "RELIANCE", "above": 1150, "below": 0}, {"sym": "TCS", "above": 0, "below": 2600},
                                                     {"sym": "TECHM", "above": 0, "below": 0}, {"sym": "BEL", "above": 0, "below": 0}]},
                   {"name": "Long Term", "items": [{"sym": "HDFCBANK", "above": 0, "below": 0}, {"sym": "INFY", "above": 0, "below": 0}]},
                   {"name": "Trading", "items": [{"sym": "TATASTEEL", "above": 0, "below": 0}]}, {"name": "Dividend", "items": [{"sym": "ITC", "above": 0, "below": 0}]}],
    "wlActive": 0,
}


class Film:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.w = imageio.get_writer(str(path), fps=FPS, codec="libx264", quality=None, macro_block_size=8, pixelformat="yuv420p",
                                    ffmpeg_params=["-crf", "22", "-preset", "slow", "-tune", "stillimage", "-movflags", "+faststart"])
        self.last = None
        self.frames = 0

    def put(self, img, n=1):
        arr = np.asarray(img.convert("RGB"))
        for _ in range(n):
            self.w.append_data(arr)
        self.last = img
        self.frames += n

    def fade_to(self, img, n=10):
        if self.last is not None:
            for k in range(1, n + 1):
                self.put(Image.blend(self.last.convert("RGB"), img.convert("RGB"), k / (n + 1)))
        self.put(img)

    def close(self):
        self.w.close()


def caption(img, title, sub=None, step=None):
    """Lower-third caption: dark glass pill with a gold accent bar."""
    img = img.convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ft, fs = ImageFont.truetype(FONT_B, 38), ImageFont.truetype(FONT_R, 26)
    tw = d.textlength(title, font=ft)
    sw = d.textlength(sub, font=fs) if sub else 0
    bw = int(max(tw, sw) + 90)
    bh = 118 if sub else 82
    x0, y0 = (W - bw) // 2, H - bh - 46
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=22, fill=(8, 8, 10, 228), outline=(212, 175, 55, 200), width=2)
    d.rounded_rectangle([x0 + 18, y0 + 20, x0 + 24, y0 + bh - 20], radius=3, fill=GOLD + (255,))
    d.text((x0 + 46, y0 + 14), title, font=ft, fill=(255, 246, 220, 255))
    if sub:
        d.text((x0 + 46, y0 + 66), sub, font=fs, fill=(207, 196, 168, 255))
    if step:
        f2 = ImageFont.truetype(FONT_B, 22)
        lbl = f"  {step}  "
        lw = d.textlength(lbl, font=f2)
        d.rounded_rectangle([W - lw - 40, 26, W - 28, 64], radius=12, fill=(8, 8, 10, 210), outline=(212, 175, 55, 160), width=2)
        d.text((W - lw - 34, 31), lbl, font=f2, fill=GOLD + (255,))
    return Image.alpha_composite(img, layer)


def shot(drv):
    return Image.open(io.BytesIO(drv.get_screenshot_as_png())).convert("RGB").resize((W, H))


def card_html(inner):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
    body{{margin:0;width:{int(W / ZOOM)}px;height:{int(H / ZOOM)}px;zoom:.8;display:grid;place-items:center;font-family:'Segoe UI',system-ui,sans-serif;color:#f6efdd;overflow:hidden;
      background:radial-gradient(900px 600px at 85% 0%,rgba(212,175,55,.22),transparent 60%),radial-gradient(800px 600px at 0% 100%,rgba(138,106,31,.25),transparent 60%),#060607}}
    .c{{text-align:center}} h1{{font-size:96px;margin:18px 0 6px;letter-spacing:-2px;background:linear-gradient(90deg,#fff6dc,#e9c766 60%,#b8901f);-webkit-background-clip:text;color:transparent}}
    h2{{font-size:40px;font-weight:600;margin:0;color:#e9dcc0}} p{{font-size:30px;color:#cfc4a8;margin:14px 0 0}} .g{{color:#e9c766;font-weight:700}}
    .pill{{display:inline-block;margin:10px 8px 0;padding:12px 24px;border:2px solid rgba(212,175,55,.5);border-radius:999px;font-size:28px;background:rgba(18,16,12,.7)}}
    .bull{{position:fixed;right:-60px;bottom:-60px;width:620px;opacity:.13}}</style></head><body>
    <img class="bull" src="{URL}bull-gold.svg"><div class="c">{inner}</div></body></html>"""


def show_card(drv, film, inner, seconds):
    p = ROOT / "reports" / "video" / "_card.html"
    p.write_text(card_html(inner), encoding="utf-8")
    drv.get(p.as_uri())
    time.sleep(0.8)
    film.fade_to(shot(drv), 12)
    film.put(film.last, int(seconds * FPS))


def go(drv, page, wait=2.5):
    drv.execute_script(f"location.hash = '{page}'; window.scrollTo(0, 0);")
    time.sleep(wait)


def hold(drv, film, seconds, title, sub=None, step=None, fresh=True):
    img = caption(shot(drv), title, sub, step) if fresh else film.last
    film.fade_to(img, 10)
    film.put(img, int(seconds * FPS))


def scroll_to(drv, film, y_target, seconds, title, sub=None, step=None):
    y0 = drv.execute_script("return window.scrollY")
    n = int(seconds * FPS / 2)  # capture every other frame and duplicate it
    for k in range(1, n + 1):
        e = 0.5 - 0.5 * np.cos(np.pi * k / n)  # ease in-out
        drv.execute_script(f"window.scrollTo(0, {int(y0 + (y_target - y0) * e)})")
        film.put(caption(shot(drv), title, sub, step), 2)


def y_of(drv, sel, offset=90):
    return drv.execute_script(f"const e=document.querySelector({json.dumps(sel)}); return e ? e.getBoundingClientRect().top + window.scrollY - {offset} : 0;")


def main():
    o = Options()
    for a in ["--headless=new", f"--window-size={int(W / ZOOM)},{int(H / ZOOM)}", f"--force-device-scale-factor={ZOOM}", "--hide-scrollbars", "--disable-gpu", "--mute-audio"]:
        o.add_argument(a)
    drv = webdriver.Chrome(options=o)
    film = Film(OUT)
    try:
        drv.get(URL)
        drv.execute_script("localStorage.setItem('dsp-state', arguments[0]); localStorage.removeItem('dsp-theme');", json.dumps(SAMPLE_STATE))
        # title
        show_card(drv, film, f'<img src="{URL}logo-gold.svg" width="150"><h1>BullScope</h1><h2>Indian Stock Market · F&amp;O · Mutual Fund &amp; Crypto Analytics</h2>'
                             f'<p>Built by <span class="g">Rahul Suryavanshi</span></p>', 3.5)
        drv.get(URL + "#overview")
        time.sleep(6)
        total = 10
        hold(drv, film, 3.0, "Market Pulse at a glance", "NIFTY 50, market mood from breadth & trend, India VIX fear gauge", f"1 / {total}")
        scroll_to(drv, film, y_of(drv, "#ovHeat", 120), 1.6, "Heatmap of all NIFTY 50 stocks", "Box size = market cap · colour = return in the selected period", f"1 / {total}")
        hold(drv, film, 2.0, "Heatmap of all NIFTY 50 stocks", "Box size = market cap · colour = return in the selected period", f"1 / {total}")
        scroll_to(drv, film, y_of(drv, "#ovNews", 140), 1.6, "Latest headlines + multiple watchlists with price alerts", "My Watchlist · Long Term · Trading · Dividend — or create your own", f"1 / {total}")
        hold(drv, film, 1.6, "Latest headlines + multiple watchlists with price alerts", "My Watchlist · Long Term · Trading · Dividend — or create your own", f"1 / {total}")
        scroll_to(drv, film, y_of(drv, "#ovWatch", 120), 1.2, "Latest headlines + multiple watchlists with price alerts", "My Watchlist · Long Term · Trading · Dividend — or create your own", f"1 / {total}")
        hold(drv, film, 1.8, "Latest headlines + multiple watchlists with price alerts", "My Watchlist · Long Term · Trading · Dividend — or create your own", f"1 / {total}")

        # search
        drv.execute_script("window.scrollTo(0,0); openSearch('');")
        time.sleep(0.6)
        for k in range(1, len("infosys") + 1):
            drv.execute_script(f"el('gsInput').value = 'infosys'.slice(0,{k}); runSearch();")
            time.sleep(0.15)
            film.put(caption(shot(drv), "Global search  (Ctrl + K)", "Stocks, 38,000+ mutual funds, coins, headlines and pages in one box", f"2 / {total}"), 5)
        time.sleep(0.8)
        hold(drv, film, 1.8, "Global search  (Ctrl + K)", "Stocks, 38,000+ mutual funds, coins, headlines and pages in one box", f"2 / {total}")
        drv.execute_script("pickSearch(0);")
        time.sleep(3)
        hold(drv, film, 2.8, "Stock Explorer", "Candles, moving averages, RSI, NSE vs BSE price, fundamentals", f"3 / {total}")
        scroll_to(drv, film, y_of(drv, "#stFund", 140), 1.6, "Signals, shareholding & 60-day outlook", "Technical score, ML probability (honestly back-tested), Monte Carlo range", f"3 / {total}")
        hold(drv, film, 2.4, "Signals, shareholding & 60-day outlook", "Technical score, ML probability (honestly back-tested), Monte Carlo range", f"3 / {total}")

        go(drv, "compare", 3)
        hold(drv, film, 3.0, "Compare up to 5 stocks, indices or funds", "Growth of ₹100, correlation heatmap, drawdown and risk table", f"4 / {total}")

        go(drv, "news", 5)
        hold(drv, film, 3.0, "Live market news from 90+ publishers", "Top stories with photos · tone check · companies & coins tagged", f"5 / {total}")
        drv.execute_script("state.newsTab='Videos'; RENDER.news();")
        time.sleep(2.5)
        hold(drv, film, 2.4, "Market videos, a personalised feed & saved stories", "CNBC-TV18, Moneycontrol, NDTV Profit, CoinDesk… played inside the app", f"5 / {total}")
        drv.execute_script("state.newsTab='Headlines'; save();")

        go(drv, "crypto", 6)
        hold(drv, film, 3.0, "Live crypto & Bitcoin", "Top 25 coins in ₹ or $, charts, dominance, Fear & Greed index", f"6 / {total}")

        go(drv, "fno", 3)
        hold(drv, film, 2.2, "F&O option chain", "Greeks, open interest, PCR, max pain, IV smile", f"7 / {total}")
        scroll_to(drv, film, y_of(drv, "#legs", 200), 1.4, "Strategy payoff builder", "Straddles, spreads, iron condor — max profit, loss, breakevens, chance of profit", f"7 / {total}")
        hold(drv, film, 2.2, "Strategy payoff builder", "Straddles, spreads, iron condor — max profit, loss, breakevens, chance of profit", f"7 / {total}")

        go(drv, "funds", 3)
        scroll_to(drv, film, y_of(drv, "#mfTable", 160), 1.2, "80 mutual funds, scored 0–100", "Returns, Sharpe, drawdown, SIP XIRR on real NAVs, 1-year projection", f"8 / {total}")
        hold(drv, film, 2.4, "80 mutual funds, scored 0–100", "Returns, Sharpe, drawdown, SIP XIRR on real NAVs, 1-year projection", f"8 / {total}")
        go(drv, "holdings", 3)
        hold(drv, film, 2.4, "Which fund owns which company", "Weights, stake in each company, what funds bought or sold this month", f"8 / {total}")

        go(drv, "portfolio", 4)
        scroll_to(drv, film, y_of(drv, "#pfTiles", 120), 1.2, "My Portfolio", "Import from Zerodha, Groww, Upstox, Angel One — P&L, risk and signals", f"9 / {total}")
        hold(drv, film, 2.2, "My Portfolio", "Import from Zerodha, Groww, Upstox, Angel One — P&L, risk and signals", f"9 / {total}")
        scroll_to(drv, film, y_of(drv, "#pfPred", 260), 1.4, "12-month prediction & health check", "Replays real market days · concentration and sell-signal warnings", f"9 / {total}")
        hold(drv, film, 2.4, "12-month prediction & health check", "Replays real market days · concentration and sell-signal warnings", f"9 / {total}")

        go(drv, "advisor", 3)
        scroll_to(drv, film, y_of(drv, "#goalTiles", 200), 1.4, "Advisor & goal planner", "Risk profile → model portfolio → monthly SIP needed for your goal", f"10 / {total}")
        hold(drv, film, 2.4, "Advisor & goal planner", "Risk profile → model portfolio → monthly SIP needed for your goal", f"10 / {total}")

        go(drv, "overview", 3)
        for bg in ["gold", "waves", "candles", "network", "sunset", "gold"]:
            drv.execute_script(f"setBackground('{bg}');")
            time.sleep(0.5)
            hold(drv, film, 0.7, "7 themes · light & dark · works on phones", "Gold & Black, Market Waves, Candlesticks, Data Network, Aurora, Sunset, Clean")

        show_card(drv, film, '<h2 style="font-size:46px">Built with</h2><div style="margin-top:22px">' + "".join(
            f'<span class="pill">{x}</span>' for x in ["Python", "pandas", "scikit-learn", "ECharts", "Power BI · 77 DAX measures", "Tableau",
                                                       "GitHub Actions", "Real NSE / BSE &amp; AMFI data"]) + "</div>", 3.2)
        show_card(drv, film, f'<img src="{URL}logo-gold.svg" width="110"><h1 style="font-size:78px">Try it live</h1>'
                             '<p style="font-size:38px"><span class="g">rahulsuryvanshi810.github.io/bullscope</span></p>'
                             '<p>Code: github.com/rahulsuryvanshi810/bullscope</p>'
                             '<p style="font-size:22px;margin-top:40px;color:#8f8670">Educational project · not investment advice</p>', 4.5)
    finally:
        film.close()
        drv.quit()
        (ROOT / "reports" / "video" / "_card.html").unlink(missing_ok=True)
    print(f"{OUT} · {film.frames / FPS:.1f} s · {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
