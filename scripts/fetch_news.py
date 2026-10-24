"""Write the latest market and crypto news to docs/news.json (the snapshot the website falls back to)."""
import json

from config import DOCS
from news import collect

if __name__ == "__main__":
    data = collect()
    (DOCS / "news.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"docs/news.json: {len(data['items'])} stories from {len(data['sources'])} sources")
