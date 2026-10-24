"""Checks on the news pipeline: RSS parsing, image extraction, tagging, tone and the snapshot file."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from news import parse_xml, tags, tone  # noqa: E402

RSS = b"""<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <item><title>Infosys shares surge 5% after strong Q2 results</title><link>https://example.com/a</link>
    <pubDate>Fri, 23 Oct 2026 10:00:00 +0530</pubDate><description>&lt;p&gt;IT major beats estimates&lt;/p&gt;</description>
    <media:content url="https://img.example.com/a.jpg" medium="image"/></item>
  <item><title>Bitcoin slumps below $80,000 as crypto market falls</title><link>https://example.com/b</link>
    <pubDate>Fri, 23 Oct 2026 11:00:00 +0530</pubDate><enclosure type="image/jpeg" url="https://img.example.com/b.jpg"/></item>
  <item><title>RBI keeps repo rate unchanged</title><link>https://example.com/c</link>
    <pubDate>Fri, 23 Oct 2026 12:00:00 +0530</pubDate><description>&lt;img src="//img.example.com/c.jpg"&gt; Policy review</description></item>
</channel></rss>"""


def test_parse_reads_items_images_and_time():
    items = parse_xml(RSS, "Example", "Markets")
    assert [i["title"][:7] for i in items] == ["Infosys", "Bitcoin", "RBI kee"]
    assert items[0]["image"] == "https://img.example.com/a.jpg"
    assert items[1]["image"] == "https://img.example.com/b.jpg"
    assert items[2]["image"] == "https://img.example.com/c.jpg"  # protocol-relative src fixed
    assert items[0]["published"] == "2026-10-23T04:30:00Z"     # converted to UTC
    assert items[0]["summary"] == "IT major beats estimates"     # HTML stripped


def test_tags_find_companies_and_coins():
    stocks, coins = tags("Infosys and Tata Motors rise; Zomato flat; bitcoin and ether slip")
    assert {"INFY", "TMPV", "ETERNAL"} <= set(stocks)
    assert coins == ["BTC", "ETH"]
    assert tags("Shares of itcorp rose")[0] == []                # no partial-word matches


def test_tone():
    assert tone("Sensex jumps 600 points, Nifty hits record high") == "Positive"
    assert tone("Markets crash as banks drop") == "Negative"
    assert tone("RBI keeps repo rate unchanged") == "Neutral"


def test_snapshot_is_well_formed():
    d = json.loads((ROOT / "docs" / "news.json").read_text(encoding="utf-8"))
    assert d["items"] and "fetched" in d
    for n in d["items"][:50]:
        assert n["link"].startswith("http") and n["title"]
        assert n["tone"] in {"Positive", "Negative", "Neutral"}
    for v in d.get("videos", [])[:20]:
        assert v["id"] and v["channel"]
