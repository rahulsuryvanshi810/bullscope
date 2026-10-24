"""Collect market news from public RSS feeds, tag each story and score its tone.

Used two ways: `python scripts/fetch_news.py` writes docs/news.json (the snapshot the website shows), and
`python serve.py` calls collect() live so the News page always has the latest headlines.
"""
import html
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

import requests

from config import STOCKS

G = "https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q="
# (url, source name or None to read it from the item, category)
FEEDS = [
    ("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times", "Markets"),
    ("https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms", "Economic Times", "Stocks"),
    ("https://economictimes.indiatimes.com/mf/rssfeeds/359241701.cms", "Economic Times", "Mutual funds"),
    ("https://www.livemint.com/rss/markets", "Mint", "Markets"),
    ("https://www.business-standard.com/rss/markets-106.rss", "Business Standard", "Markets"),
    (G + "sensex+nifty+stock+market+when:1d", None, "Markets"),
    (G + "NSE+shares+stocks+results+when:1d", None, "Stocks"),
    (G + "mutual+fund+SIP+NAV+when:3d", None, "Mutual funds"),
    (G + "RBI+inflation+GDP+India+economy+when:2d", None, "Economy"),
    (G + "Wall+Street+Fed+global+markets+when:1d", None, "Global"),
    (G + "bitcoin+OR+crypto+OR+ethereum+when:1d", None, "Crypto"),
    ("https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml", "CoinDesk", "Crypto"),
    ("https://cointelegraph.com/rss", "Cointelegraph", "Crypto"),
    ("https://decrypt.co/feed", "Decrypt", "Crypto"),
    ("https://economictimes.indiatimes.com/markets/cryptocurrency/rssfeeds/82519373.cms", "Economic Times", "Crypto"),
    ("https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms", "Economic Times", "Economy"),
    ("https://economictimes.indiatimes.com/news/company/rssfeeds/2143429.cms", "Economic Times", "Stocks"),
    ("https://www.livemint.com/rss/companies", "Mint", "Stocks"),
    ("https://www.livemint.com/rss/money", "Mint", "Mutual funds"),
    ("https://www.livemint.com/rss/economy", "Mint", "Economy"),
    ("https://www.business-standard.com/rss/economy-102.rss", "Business Standard", "Economy"),
    ("https://www.business-standard.com/rss/companies-101.rss", "Business Standard", "Stocks"),
]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BullScope news reader"}
MEDIA = "{http://search.yahoo.com/mrss/}"

POS = {"surge", "surges", "jump", "jumps", "rally", "rallies", "gain", "gains", "rise", "rises", "soar", "soars", "record", "high",
       "beat", "beats", "upgrade", "profit", "growth", "bullish", "boost", "rebound", "climbs", "strong", "buy", "inflows", "outperform", "up"}
NEG = {"fall", "falls", "drop", "drops", "slump", "slumps", "crash", "plunge", "plunges", "loss", "losses", "decline", "declines", "weak",
       "miss", "misses", "downgrade", "bearish", "sell-off", "selloff", "tumble", "tumbles", "slips", "cut", "fear", "outflows", "down", "lower", "worst"}
CRYPTO = {"bitcoin": "BTC", "btc": "BTC", "ethereum": "ETH", "ether": "ETH", "solana": "SOL", "xrp": "XRP", "dogecoin": "DOGE", "bnb": "BNB"}
ALIASES = {sym: {name.lower().replace(" limited", ""), sym.lower()} for sym, (name, _) in STOCKS.items()}
ALIASES["ETERNAL"] |= {"zomato"}
ALIASES["TMPV"] |= {"tata motors"}
ALIASES["M&M"] |= {"mahindra"}
ALIASES["HINDUNILVR"] |= {"hul"}
ALIASES["SBIN"] |= {"sbi"}
ALIASES["LT"] = {"larsen", "l&t"}
ALIASES["ITC"] = {"itc"}
ALIASES["BEL"] = {"bharat electronics"}


def clean(text):
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()


def tone(title):
    words = set(re.findall(r"[a-z\-]+", title.lower()))
    s = len(words & POS) - len(words & NEG)
    return "Positive" if s > 0 else "Negative" if s < 0 else "Neutral"


def tags(text):
    low = " " + text.lower() + " "
    found = [sym for sym, names in ALIASES.items() if any(re.search(r"(?<![a-z])" + re.escape(n) + r"(?![a-z])", low) for n in names if len(n) > 2)]
    coins = sorted({c for k, c in CRYPTO.items() if re.search(r"(?<![a-z])" + k + r"(?![a-z])", low)})
    return found, coins


def parse(url, source, category):
    try:
        r = requests.get(url, headers=UA, timeout=12)
        r.raise_for_status()
        return parse_xml(r.content, source, category)
    except Exception:
        return []


def parse_xml(content, source, category):
    root = ET.fromstring(content)
    out = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        if not title:
            continue
        src = source
        s_el = it.find("source")
        if source is None:
            src = clean(s_el.text) if s_el is not None and s_el.text else "Google News"
            title = re.sub(r"\s+-\s+[^-]+$", "", title)  # Google appends " - Publisher"
        try:
            ts = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except Exception:
            ts = datetime.now(timezone.utc)
        img = None
        for e in it.iter():  # media:content, media:thumbnail or enclosure, whatever namespace the feed uses
            tag = e.tag.split("}")[-1]
            if tag in ("content", "thumbnail", "enclosure") and e.get("url") and (e.get("type", "image").startswith("image") or e.get("medium") == "image"):
                img = e.get("url")
                break
        if not img:
            m = re.search(r'<img[^>]+src="([^"]+)"', it.findtext("description") or "")
            img = m.group(1) if m else None
        if img and img.startswith("//"):
            img = "https:" + img
        summary = clean(it.findtext("description"))
        if source is None:
            summary = ""  # Google's description just repeats the title and links
        stocks, coins = tags(title + " " + summary)
        out.append({"direct": source is not None, "title": title, "link": (it.findtext("link") or "").strip(), "source": src, "category": category,
                    "published": ts.isoformat().replace("+00:00", "Z"), "summary": summary[:280], "image": img,
                    "tone": tone(title), "stocks": stocks, "coins": coins})
    return out


CHANNELS = [  # YouTube channel id, name, category
    ("UCmRbHAgG2k2vDUvb3xsEunQ", "CNBC-TV18", "Markets"),
    ("UCQIycDaLsBpMKjOCeaKUYVg", "CNBC Awaaz", "Markets"),
    ("UChftTVI0QJmyXkajQYt2tiQ", "Moneycontrol", "Markets"),
    ("UC3uJIdRFTGgLWrUziaHbzrg", "NDTV Profit", "Markets"),
    ("UCxTtau4q4SXhWXj28Sm12ag", "Business Today", "Economy"),
    ("UC7TghOL755nBk7HelHoi9LQ", "CoinDesk", "Crypto"),
    ("UCqK_GSMbpiV8spgD3ZGloSw", "Coin Bureau", "Crypto"),
]
ATOM, YT = "{http://www.w3.org/2005/Atom}", "{http://www.youtube.com/xml/schemas/2015}"


def channel_videos(cid, name, category):
    try:
        root = ET.fromstring(requests.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", headers=UA, timeout=12).content)
    except Exception:
        return []
    out = []
    for e in root.iter(ATOM + "entry"):
        vid = e.findtext(YT + "videoId")
        title = clean(e.findtext(ATOM + "title"))
        if not vid or not title or "#shorts" in title.lower():
            continue
        group = e.find(MEDIA + "group")
        desc = clean(group.findtext(MEDIA + "description")) if group is not None else ""
        stats = e.find(f"{MEDIA}group/{MEDIA}community/{MEDIA}statistics")
        stocks, coins = tags(title + " " + desc[:300])
        out.append({"id": vid, "title": title, "channel": name, "category": category, "published": e.findtext(ATOM + "published"),
                    "views": int(stats.get("views", 0)) if stats is not None else 0, "summary": desc[:220],
                    "stocks": stocks, "coins": coins})
    return out


FIN_WORDS = re.compile(r"market|stock|share|nifty|sensex|ipo|fund|sip|rbi|gdp|inflation|econom|budget|result|q[1-4]|profit|rupee|gold|silver|"
                       r"tax|invest|trade|tariff|fed|bank|crypto|bitcoin|ethereum|earning|dividend|bse|nse|f&o|option|rate|oil|portfolio|wealth|money|"
                       r"finance|business|company|ceo|sector|rally|crash|bull|bear", re.I)


def collect_videos():
    with ThreadPoolExecutor(max_workers=7) as ex:
        vids = [v for b in ex.map(lambda c: channel_videos(*c), CHANNELS) for v in b]
    vids = [v for v in vids if v["category"] == "Crypto" or FIN_WORDS.search(v["title"])]
    return sorted(vids, key=lambda v: v["published"], reverse=True)[:80]


def collect(max_age_hours=96):
    with ThreadPoolExecutor(max_workers=8) as ex:
        batches = list(ex.map(lambda f: parse(*f), FEEDS))
    seen, items = set(), []
    cutoff = time.time() - max_age_hours * 3600
    for item in sorted((i for b in batches for i in b), key=lambda i: i["published"], reverse=True):
        key = re.sub(r"[^a-z0-9]", "", item["title"].lower())[:70]
        if key in seen or datetime.fromisoformat(item["published"].replace("Z", "+00:00")).timestamp() < cutoff:
            continue
        seen.add(key)
        if item["coins"] and item["category"] not in ("Crypto",):
            item["category"] = "Crypto" if not item["stocks"] else item["category"]
        items.append(item)
    # crypto feeds publish far more often than Indian market feeds; keep them from crowding out the rest
    # and keep Google-aggregated crypto items to 40 so the publishers' own feeds (with photos) stay visible
    drop = [i for i in items if i["category"] == "Crypto" and not i["direct"]][40:]
    items = [i for i in items if i not in drop]
    for i in items:
        i.pop("direct", None)
    return {"fetched": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), "videos": collect_videos(),
            "sources": sorted({i["source"] for i in items}), "items": items[:500]}
