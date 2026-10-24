"""Open BullScope on this PC with live news.

    python serve.py            # http://127.0.0.1:8765, opens your browser

Serves the dashboard from docs/ and adds /api/news, which fetches the latest headlines from the news feeds
(cached for 5 minutes). Without this server the dashboard falls back to docs/news.json.
"""
import json
import sys
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
from news import collect  # noqa: E402

PORT = 8765
CACHE = {"at": 0.0, "data": None}
LOCK = threading.Lock()


def latest_news():
    with LOCK:
        if CACHE["data"] is None or time.time() - CACHE["at"] > 300:
            CACHE["data"], CACHE["at"] = collect(), time.time()
        return CACHE["data"]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/api/news":
            body = json.dumps(latest_news(), ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(ROOT / "docs")))
    url = f"http://127.0.0.1:{PORT}/"
    print(f"BullScope running at {url} with live news. Press Ctrl+C to stop.")
    threading.Thread(target=latest_news, daemon=True).start()  # warm the news cache
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("stopped")
