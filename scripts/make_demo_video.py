"""Record a plain screen-recording style demo of BullScope in a Chrome window (for LinkedIn / README).

    python serve.py                       # in one terminal (live news)
    python scripts/make_demo_video.py     # writes reports/video/bullscope_demo.mp4

Headless Chrome renders the page; each frame is placed inside a drawn Chrome window (tabs + address bar).
The pointer moves like a hand on a mouse: curved paths, uneven speed, a small overshoot, wheel-step
scrolling and uneven typing. It turns into a hand over clickable things and an I-beam over text boxes.
No captions or title cards: it should look exactly like a screen recording.
"""
import io
import json
import math
import random
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
SERVE = "http://127.0.0.1:8765/"
SHOWN_URL = "rahulsuryvanshi810.github.io/bullscope/"
W, H, FPS = 1920, 1080, 30
ZOOM = 1.25            # Windows display scaling 125%
CH = 104               # height of the drawn Chrome tab strip + toolbar
PH = H - CH            # page viewport height on screen
FONT = "C:/Windows/Fonts/segoeui.ttf"
SYM = "C:/Windows/Fonts/seguisym.ttf"
rnd = random.Random(7)
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


# ------------------------------------------------------------------------------------------- cursors (Windows look, 125%)
def _cursor(points, size, hot, lines=()):
    s = 4
    pts = [(x * s, y * s) for x, y in points]
    im = Image.new("RGBA", (size[0] * s, size[1] * s), (0, 0, 0, 0))
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon([(x + 1.2 * s, y + 1.6 * s) for x, y in pts], fill=(0, 0, 0, 80))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(1.4 * s)))
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255))
    d.line(pts + [pts[0]], fill=(0, 0, 0, 255), width=int(1.05 * s), joint="curve")
    for a, b in lines:
        d.line([(a[0] * s, a[1] * s), (b[0] * s, b[1] * s)], fill=(0, 0, 0, 255), width=int(1.0 * s))
    return im.resize(size, Image.LANCZOS), hot


ARROW = _cursor([(2, 2), (2, 19), (6.2, 15.2), (9, 21.5), (11.6, 20.4), (8.9, 14.2), (14, 14.2)], (20, 26), (2, 2))
HAND = _cursor([(7, 2.2), (8.2, 1.2), (9.4, 2.2), (9.4, 10), (10.4, 9.2), (11.8, 9.6), (12.2, 10.6), (13.2, 10), (14.6, 10.6), (14.9, 11.6),
                (15.9, 11.2), (17.2, 12), (17.2, 17.5), (15.6, 21.5), (14.4, 24), (8.2, 24), (6.6, 21), (2.6, 15.6), (2.8, 13.8),
                (4.4, 13.6), (6.6, 15.8), (6.6, 3)],
               (20, 27), (8, 1), lines=[((9.4, 10), (9.4, 14)), ((12.2, 10.6), (12.2, 14)), ((14.9, 11.6), (14.9, 14))])
_ib = Image.new("RGBA", (12, 24), (0, 0, 0, 0))
_d = ImageDraw.Draw(_ib)
for col, wdt in [((255, 255, 255, 255), 4), ((0, 0, 0, 255), 2)]:
    _d.line([(6, 3), (6, 21)], fill=col, width=wdt)
    _d.line([(3, 2), (5, 3), (7, 3), (9, 2)], fill=col, width=wdt - 1)
    _d.line([(3, 22), (5, 21), (7, 21), (9, 22)], fill=col, width=wdt - 1)
IBEAM = (_ib, (6, 12))


# ------------------------------------------------------------------------------------------- chrome window
def chrome_frame(url_text, title="BullScope", caret=False, favicon=None, loading=False):
    """Dark-theme Chrome tab strip and toolbar at 125%."""
    im = Image.new("RGB", (W, CH), (32, 33, 36))
    d = ImageDraw.Draw(im)
    f16, f18 = ImageFont.truetype(FONT, 16), ImageFont.truetype(FONT, 18)
    d.rounded_rectangle([14, 8, 330, 56], radius=12, fill=(53, 54, 58))   # active tab
    d.rectangle([14, 40, 330, 56], fill=(53, 54, 58))
    if favicon is not None and not loading:
        im.paste(favicon, (30, 21), favicon)
    elif loading:
        d.arc([30, 21, 50, 41], 30, 300, fill=(138, 180, 248), width=3)
    d.text((60, 20), title, font=f16, fill=(232, 234, 237))
    d.text((300, 17), "×", font=f18, fill=(189, 193, 198))
    d.text((350, 12), "+", font=ImageFont.truetype(FONT, 24), fill=(189, 193, 198))
    for i, g in enumerate(["—", "☐", "✕"]):                                # window controls
        d.text((W - 160 + i * 56, 13), g, font=ImageFont.truetype(SYM, 18), fill=(189, 193, 198))
    d.rectangle([0, 56, W, CH], fill=(53, 54, 58))                          # toolbar
    for i, g in enumerate(["←", "→", "↻"]):
        d.text((22 + i * 46, 63), g, font=ImageFont.truetype(SYM, 22), fill=(110, 113, 118) if i == 1 else (189, 193, 198))
    d.rounded_rectangle([160, 62, W - 150, 98], radius=18, fill=(32, 33, 36))
    tx = 214
    if url_text:
        d.rounded_rectangle([180, 70, 202, 90], radius=10, fill=(53, 54, 58))  # site-info chip
        d.text((185, 67), "⚙", font=ImageFont.truetype(SYM, 15), fill=(189, 193, 198))
        d.text((tx, 67), url_text, font=f18, fill=(232, 234, 237))
        if caret:
            x = tx + d.textlength(url_text, font=f18) + 2
            d.line([(x, 70), (x, 94)], fill=(232, 234, 237), width=2)
    else:
        if caret:
            d.line([(tx, 70), (tx, 94)], fill=(232, 234, 237), width=2)
        d.text((tx + 8, 67), "Search Google or type a URL", font=f18, fill=(154, 160, 166))
    d.text((W - 130, 62), "⋮", font=ImageFont.truetype(FONT, 22), fill=(189, 193, 198))
    d.ellipse([W - 92, 66, W - 64, 94], fill=(66, 133, 244))
    d.text((W - 84, 68), "R", font=f16, fill=(255, 255, 255))
    d.line([(0, CH - 1), (W, CH - 1)], fill=(20, 20, 22))
    return im


# ------------------------------------------------------------------------------------------- film
class Film:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.w = imageio.get_writer(str(path), fps=FPS, codec="libx264", quality=None, macro_block_size=8, pixelformat="yuv420p",
                                    ffmpeg_params=["-crf", "21", "-preset", "slow", "-movflags", "+faststart"])
        self.frames = 0

    def put(self, img, n=1):
        arr = np.asarray(img.convert("RGB"))
        for _ in range(n):
            self.w.append_data(arr)
        self.frames += n

    def close(self):
        self.w.close()


class Recorder:
    def __init__(self, drv, film, favicon):
        self.d, self.f, self.fav = drv, film, favicon
        self.x, self.y = W * 0.62, H * 0.55
        self.kind = "arrow"
        self.page = None
        self.chrome = None
        self.url_override = None

    # ---- frames
    def url_text(self):
        if self.url_override is not None:
            return self.url_override
        h = self.d.execute_script("return location.hash")
        return SHOWN_URL + (h if h and h != "#overview" else "")

    def grab(self):
        png = self.d.get_screenshot_as_png()
        self.page = Image.open(io.BytesIO(png)).convert("RGB").resize((W, PH))
        if self.url_override is None:
            self.chrome = chrome_frame(self.url_text(), favicon=self.fav)
        return self.page

    def compose(self):
        img = Image.new("RGBA", (W, H))
        img.paste(self.chrome, (0, 0))
        img.paste(self.page, (0, CH))
        cur, hot = {"arrow": ARROW, "hand": HAND, "text": IBEAM}[self.kind]
        img.alpha_composite(cur, (int(round(self.x)) - hot[0], int(round(self.y)) - hot[1]))
        return img

    def out(self, n=1):
        self.f.put(self.compose(), n)

    def pause(self, lo, hi=None):
        self.out(max(1, int(FPS * (lo if hi is None else rnd.uniform(lo, hi)))))

    # ---- pointer
    def real_move(self):
        if self.y < CH:
            return
        try:
            ab = ActionBuilder(self.d)
            ab.pointer_action.move_to_location(int(min(max(self.x, 1), W - 2) / ZOOM), int(min(max(self.y - CH, 1), PH - 2) / ZOOM))
            ab.perform()
        except Exception:
            pass

    def cursor_kind(self):
        if self.y < CH:
            return "text" if 160 < self.x < W - 150 and 62 < self.y < 98 else "arrow"
        return self.d.execute_script(f"""const e=document.elementFromPoint({self.x / ZOOM},{(self.y - CH) / ZOOM}); if(!e) return 'arrow';
            if(e.matches('input:not([type=checkbox]):not([type=file]),textarea')) return 'text';
            return getComputedStyle(e).cursor==='pointer' ? 'hand' : 'arrow';""")

    def move(self, x, y):
        """Human-like move: curved path, fast start and slow finish, slight overshoot, tiny jitter."""
        x0, y0 = self.x, self.y
        dist = math.hypot(x - x0, y - y0)
        if dist < 2:
            return
        dur = 0.22 + 0.00042 * dist + rnd.uniform(-0.04, 0.08)
        n = max(5, int(dur * FPS))
        nx, ny = -(y - y0) / dist, (x - x0) / dist
        bend = rnd.uniform(-0.12, 0.12) * dist
        cx, cy = (x0 + x) / 2 + nx * bend, (y0 + y) / 2 + ny * bend
        over = rnd.uniform(0.0, 0.035)
        for k in range(1, n + 1):
            t = k / n
            e = 1 - (1 - t) ** 3
            e = e * (1 + over * math.sin(math.pi * t))
            px = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e ** 2 * x
            py = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * cy + e ** 2 * y
            self.x, self.y = px + rnd.uniform(-0.4, 0.4), py + rnd.uniform(-0.4, 0.4)
            self.out()
        self.x, self.y = x, y
        self.real_move()
        time.sleep(0.25)
        self.kind = self.cursor_kind()
        if self.url_override is None:
            self.grab()
        self.out(2)

    # ---- elements
    def rect(self, sel):
        r = self.d.execute_script(f"const e=document.querySelector({json.dumps(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.left,b.top,b.width,b.height];")
        return None if r is None else [r[0] * ZOOM, r[1] * ZOOM + CH, r[2] * ZOOM, r[3] * ZOOM]

    def point_in(self, sel, xf=None, yf=None):
        r = self.rect(sel)
        if not r:
            return None
        xf = rnd.uniform(0.35, 0.6) if xf is None else xf
        yf = rnd.uniform(0.4, 0.6) if yf is None else yf
        return min(max(r[0] + r[2] * xf, 4), W - 6), min(max(r[1] + r[3] * yf, CH + 4), H - 6)

    def bring_into_view(self, sel, top=0.25):
        r = self.rect(sel)
        if r and (r[1] < CH + 60 or r[1] + min(r[3], 200) > H - 40):
            self.wheel((r[1] - CH) - PH * top)

    def click(self, sel, xf=None, yf=None, wait=1.0):
        self.bring_into_view(sel)
        p = self.point_in(sel, xf, yf)
        if not p:
            return
        self.move(*p)
        self.pause(0.08, 0.22)
        try:
            ActionChains(self.d).click().perform()
        except Exception:
            self.d.execute_script(f"document.querySelector({json.dumps(sel)}).click()")
        time.sleep(wait)
        self.kind = self.cursor_kind()
        self.grab()
        self.out(3)

    def hover(self, sel, xf=None, yf=None, hold=(0.8, 1.4)):
        self.bring_into_view(sel)
        p = self.point_in(sel, xf, yf)
        if p:
            self.move(*p)
            self.pause(*hold)

    def sweep(self, sel, x0f, x1f, yf, seconds=1.6):
        """Run the pointer across a chart so the tooltip follows it."""
        self.bring_into_view(sel)
        a, b = self.point_in(sel, x0f, yf), self.point_in(sel, x1f, yf)
        if not a:
            return
        self.move(*a)
        steps = max(4, int(seconds * FPS / 3))
        for k in range(1, steps + 1):
            t = k / steps
            self.x = a[0] + (b[0] - a[0]) * t + rnd.uniform(-0.6, 0.6)
            self.y = a[1] + (b[1] - a[1]) * t + 3 * math.sin(t * 5) + rnd.uniform(-0.6, 0.6)
            self.real_move()
            time.sleep(0.04)
            self.grab()
            self.out(3)

    def wheel(self, dy_screen):
        """Mouse-wheel scrolling: notches of ~100 CSS px, each eased over a few frames, with small gaps."""
        dy = dy_screen / ZOOM
        notches = max(1, int(round(abs(dy) / 100)))
        step = dy / notches
        for _ in range(notches):
            y0 = self.d.execute_script("return window.scrollY")
            for k in range(1, 4):
                e = 1 - (1 - k / 3) ** 2
                self.d.execute_script(f"window.scrollTo(0,{y0 + step * e})")
                self.grab()
                self.out()
            if rnd.random() < 0.25:
                self.out(rnd.randint(1, 3))
        self.real_move()
        time.sleep(0.15)
        self.kind = self.cursor_kind()
        self.grab()
        self.out(2)

    def wheel_to(self, sel, top=0.18):
        r = self.rect(sel)
        if r:
            self.wheel((r[1] - CH) - PH * top)

    def type(self, text, lo=0.07, hi=0.2):
        for ch in text:
            ActionChains(self.d).send_keys(ch).perform()
            time.sleep(0.05)
            self.grab()
            self.out(max(2, int(FPS * rnd.uniform(lo, hi))))

    def go(self, page, wait=2.4):
        self.click(f'#nav a[data-page="{page}"]', wait=wait)


def main():
    o = Options()
    for a in ["--headless=new", f"--window-size={int(W / ZOOM)},{int(PH / ZOOM)}", f"--force-device-scale-factor={ZOOM}", "--hide-scrollbars",
              "--disable-gpu", "--mute-audio"]:
        o.add_argument(a)
    drv = webdriver.Chrome(options=o)
    film = Film(OUT)
    drv.get(SERVE + "logo.svg")
    time.sleep(0.5)
    fav = Image.open(io.BytesIO(drv.find_element("tag name", "svg").screenshot_as_png)).convert("RGBA").resize((20, 20), Image.LANCZOS)
    rec = Recorder(drv, film, fav)
    try:
        drv.get(SERVE)
        drv.execute_script("localStorage.setItem('dsp-state', arguments[0]); localStorage.setItem('dsp-theme', 'dark');", json.dumps(STATE))

        # ---- new tab: click the address bar and type the site
        drv.get("about:blank")
        drv.execute_script("document.documentElement.style.background='#202124'; document.body.style.background='#202124'")
        rec.url_override = ""
        rec.grab()
        rec.chrome = chrome_frame("", title="New Tab")
        rec.pause(0.9)
        rec.move(640, 80)
        rec.pause(0.15)
        rec.chrome = chrome_frame("", title="New Tab", caret=True)
        rec.pause(0.4)
        typed = ""
        for ch in SHOWN_URL:
            typed += ch
            rec.chrome = chrome_frame(typed, title="New Tab", caret=True)
            rec.out(max(1, int(FPS * rnd.uniform(0.03, 0.11))))
        rec.pause(0.35)
        rec.chrome = chrome_frame(SHOWN_URL, title="BullScope", loading=True)
        rec.out(10)
        drv.get(SERVE + "#overview")
        time.sleep(6)
        rec.url_override = None
        rec.grab()
        rec.out(4)
        rec.move(980, 520)
        rec.pause(1.0, 1.4)

        # ---- overview
        rec.hover("#ovHero", 0.62, 0.55, (0.6, 0.9))
        rec.hover("#ovTiles .tile:nth-child(3)", 0.5, 0.45, (0.5, 0.8))
        rec.wheel_to("#ovIdxChart", 0.22)
        rec.sweep("#ovIdxChart", 0.25, 0.8, 0.45, 1.8)
        rec.wheel_to("#ovHeat", 0.08)
        rec.hover("#ovHeat", 0.12, 0.3, (0.9, 1.2))
        rec.hover("#ovHeat", 0.55, 0.25, (0.9, 1.2))
        rec.wheel_to("#ovNews", 0.12)
        rec.pause(0.8, 1.1)
        rec.wheel_to("#ovWatch", 0.15)
        rec.click('#ovWatch .wl-tab[data-wl="1"]', wait=0.7)
        rec.pause(0.8, 1.1)
        rec.click('#ovWatch .wl-tab[data-wl="0"]', wait=0.7)
        rec.wheel_to("#ovSeason", 0.15)
        rec.hover("#ovSeason", 0.6, 0.4, (0.9, 1.2))
        rec.wheel(-6000)

        # ---- search -> stock
        rec.click("#gsOpen", wait=0.5)
        rec.type("infosys")
        time.sleep(0.4)
        rec.grab()
        rec.pause(0.7, 1.0)
        rec.click("#gsList .gs-item", wait=3)
        rec.sweep("#stCandle", 0.4, 0.9, 0.3, 2.0)
        rec.wheel_to("#stFund", 0.18)
        rec.pause(1.2, 1.6)
        rec.wheel_to("#stMC", 0.2)
        rec.hover("#stMC", 0.88, 0.45, (1.0, 1.4))

        # ---- compare
        rec.go("compare", 2.6)
        rec.sweep("#cmpGrowth", 0.3, 0.85, 0.45, 1.6)
        rec.wheel_to("#cmpTable", 0.25)
        rec.pause(1.0, 1.4)

        # ---- news
        rec.go("news", 3.5)
        rec.pause(0.6, 0.9)
        rec.wheel_to("#newsTopWrap", 0.05)
        rec.hover("#newsTop .ts-wrap:nth-child(1)", 0.5, 0.5, (0.8, 1.1))
        rec.hover("#newsTop .ts-wrap:nth-child(3)", 0.5, 0.5, (0.6, 0.9))
        rec.wheel(900)
        rec.pause(0.6, 0.9)
        rec.wheel(-3000)
        rec.click('#newsTabs [data-tab="Videos"]', wait=2.5)
        rec.hover("#vidGrid .vid:nth-child(2)", 0.5, 0.35, (0.9, 1.2))
        rec.click('#newsTabs [data-tab="Headlines"]', wait=1.0)

        # ---- crypto
        rec.go("crypto", 6)
        rec.click('#cryDays button[data-v="1Y"]', wait=3)
        rec.sweep("#cryChart", 0.3, 0.85, 0.4, 1.6)
        rec.wheel_to("#cryTable", 0.12)
        rec.pause(1.0, 1.3)

        # ---- F&O
        rec.go("fno", 3)
        rec.sweep("#fnoOI", 0.35, 0.7, 0.5, 1.3)
        rec.wheel_to("#fnoChain", 0.08)
        rec.click("#fnoChain tr.atm .ltp", wait=1.0)
        rec.wheel_to("#payoff", 0.35)
        rec.sweep("#payoff", 0.25, 0.8, 0.5, 1.6)

        # ---- funds + holdings
        rec.go("funds", 3)
        rec.click("#mfSearch", wait=0.3)
        rec.type("parag parikh")
        time.sleep(2)
        rec.grab()
        rec.pause(0.8, 1.1)
        drv.execute_script("el('mfSearch').value=''; el('mfResults').innerHTML='';")
        rec.wheel_to("#mfTable", 0.08)
        rec.pause(0.6, 0.9)
        rec.click("#mfTable tbody tr:nth-child(2)", 0.2, 0.5, wait=2.0)
        rec.wheel_to("#mfTiles", 0.06)
        rec.sweep("#mfGrowth", 0.3, 0.85, 0.5, 1.4)
        rec.go("holdings", 2.5)
        rec.click('#hMode button[data-v="By company"]', wait=1.4)
        rec.pause(1.0, 1.3)

        # ---- portfolio
        rec.go("portfolio", 2.5)
        rec.click("#pfSample", wait=2.5)
        rec.wheel_to("#pfTiles", 0.08)
        rec.pause(1.2, 1.5)
        rec.wheel_to("#pfPred", 0.3)
        rec.sweep("#pfPred", 0.4, 0.92, 0.42, 1.4)
        rec.wheel(700)
        rec.pause(0.8, 1.0)

        # ---- advisor
        rec.go("advisor", 2.5)
        rec.pause(0.6, 0.9)
        rec.wheel_to("#goalTiles", 0.3)
        rec.sweep("#goalChart", 0.3, 0.9, 0.5, 1.4)

        # ---- back home
        rec.go("overview", 2.5)
        rec.move(1100, 560)
        rec.pause(1.5)
    finally:
        film.close()
        drv.quit()
    print(f"{OUT} · {film.frames / FPS:.1f} s · {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
