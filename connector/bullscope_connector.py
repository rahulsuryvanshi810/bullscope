"""BullScope broker connector: syncs your demat holdings into the BullScope dashboard.

Runs only on your own PC (http://127.0.0.1:8766). You log in on the broker's own website; this helper
receives the short-lived access token from the broker's redirect, keeps it in memory only, and hands
the dashboard a plain list of holdings. Your API secret stays in connector/.env on your PC.

    python bullscope_connector.py            # real brokers (needs .env, see .env.example)
    python bullscope_connector.py --demo     # sample holdings, no broker account needed

Supported: Zerodha (Kite Connect), Upstox (API v2), Angel One (SmartAPI publisher login).
Groww has no personal API: use the file import in the dashboard instead.
"""
import hashlib
import json
import os
import secrets
import sys
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

HOST, PORT = "127.0.0.1", 8766
BASE = f"http://{HOST}:{PORT}"
HERE = Path(__file__).resolve().parent
DEMO = "--demo" in sys.argv

# pages allowed to read holdings from this helper
ALLOWED_ORIGINS = {"http://localhost:8765", "http://127.0.0.1:8765", "https://rahulsuryvanshi810.github.io", "null"}


def load_env():
    env = {}
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith(("KITE_", "UPSTOX_", "ANGEL_", "BULLSCOPE_"))})
    return env


ENV = load_env()
for o in ENV.get("BULLSCOPE_EXTRA_ORIGINS", "").split(","):
    if o.strip():
        ALLOWED_ORIGINS.add(o.strip())

SESSIONS = {}   # broker -> {"token": ..., "at": epoch}
STATES = {}     # oauth state -> broker (guards the redirect against forgery)
AMFI_ISIN = {}  # mutual fund ISIN -> AMFI scheme code


def amfi_code(isin):
    """Map a mutual fund ISIN to its AMFI scheme code using AMFI's public NAV file (cached)."""
    if not AMFI_ISIN:
        try:
            txt = requests.get("https://www.amfiindia.com/spages/NAVAll.txt", timeout=30).text
            for line in txt.splitlines():
                p = line.split(";")
                if len(p) >= 6 and p[0].strip().isdigit():
                    for isin_ in (p[1], p[2]):
                        if isin_.strip().startswith("INF"):
                            AMFI_ISIN[isin_.strip()] = int(p[0])
        except requests.RequestException:
            return None
    return AMFI_ISIN.get(isin)


def row(broker, kind, symbol, name, isin, qty, avg, ltp, amfi=None):
    return {"broker": broker, "kind": kind, "symbol": (symbol or "").upper(), "name": name or symbol, "isin": isin,
            "qty": float(qty or 0), "avg": float(avg or 0), "ltp": float(ltp or 0), "amfi_code": amfi}


# ------------------------------------------------------------------------------------------- Zerodha
class Zerodha:
    name = "Zerodha"

    def ready(self):
        return bool(ENV.get("KITE_API_KEY") and ENV.get("KITE_API_SECRET"))

    def login_url(self, state):
        return "https://kite.zerodha.com/connect/login?" + urlencode({"v": 3, "api_key": ENV["KITE_API_KEY"], "redirect_params": f"state={state}"})

    def exchange(self, q):
        req = q["request_token"][0]
        key, secret = ENV["KITE_API_KEY"], ENV["KITE_API_SECRET"]
        r = requests.post("https://api.kite.trade/session/token", headers={"X-Kite-Version": "3"}, timeout=20, data={
            "api_key": key, "request_token": req, "checksum": hashlib.sha256((key + req + secret).encode()).hexdigest()})
        r.raise_for_status()
        return r.json()["data"]["access_token"]

    def holdings(self, token):
        h = {"X-Kite-Version": "3", "Authorization": f"token {ENV['KITE_API_KEY']}:{token}"}
        out = []
        for x in requests.get("https://api.kite.trade/portfolio/holdings", headers=h, timeout=20).json().get("data", []):
            qty = (x.get("quantity") or 0) + (x.get("t1_quantity") or 0)
            if qty:
                out.append(row("Zerodha", "equity", x["tradingsymbol"], x["tradingsymbol"], x.get("isin"), qty, x.get("average_price"), x.get("last_price")))
        for x in requests.get("https://api.kite.trade/mf/holdings", headers=h, timeout=20).json().get("data", []):
            if x.get("quantity"):
                out.append(row("Zerodha", "mf", x["tradingsymbol"], x.get("fund"), x["tradingsymbol"], x["quantity"],
                               x.get("average_price"), x.get("last_price"), amfi_code(x["tradingsymbol"])))
        return out


# ------------------------------------------------------------------------------------------- Upstox
class Upstox:
    name = "Upstox"

    def ready(self):
        return bool(ENV.get("UPSTOX_API_KEY") and ENV.get("UPSTOX_API_SECRET"))

    def login_url(self, state):
        return "https://api.upstox.com/v2/login/authorization/dialog?" + urlencode({
            "response_type": "code", "client_id": ENV["UPSTOX_API_KEY"], "redirect_uri": f"{BASE}/callback/upstox", "state": state})

    def exchange(self, q):
        r = requests.post("https://api.upstox.com/v2/login/authorization/token", timeout=20, headers={"Accept": "application/json"}, data={
            "code": q["code"][0], "client_id": ENV["UPSTOX_API_KEY"], "client_secret": ENV["UPSTOX_API_SECRET"],
            "redirect_uri": f"{BASE}/callback/upstox", "grant_type": "authorization_code"})
        r.raise_for_status()
        return r.json()["access_token"]

    def holdings(self, token):
        r = requests.get("https://api.upstox.com/v2/portfolio/long-term-holdings", timeout=20,
                         headers={"Accept": "application/json", "Authorization": f"Bearer {token}"})
        out = []
        for x in r.json().get("data", []) or []:
            qty = (x.get("quantity") or 0) + (x.get("t1_quantity") or 0)
            if qty:
                sym = x.get("trading_symbol") or x.get("tradingsymbol")
                out.append(row("Upstox", "equity", sym, x.get("company_name") or sym, x.get("isin"), qty, x.get("average_price"), x.get("last_price")))
        return out


# ------------------------------------------------------------------------------------------- Angel One
class AngelOne:
    name = "Angel One"

    def ready(self):
        return bool(ENV.get("ANGEL_API_KEY"))

    def login_url(self, state):
        return "https://smartapi.angelone.in/publisher-login?" + urlencode({"api_key": ENV["ANGEL_API_KEY"], "state": state})

    def exchange(self, q):
        return q["auth_token"][0]

    def holdings(self, token):
        h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json",
             "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1",
             "X-MACAddress": "00:00:00:00:00:00", "X-PrivateKey": ENV["ANGEL_API_KEY"]}
        r = requests.get("https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding", headers=h, timeout=20)
        data = (r.json().get("data") or {}).get("holdings") or []
        out = []
        for x in data:
            if x.get("quantity"):
                sym = (x.get("tradingsymbol") or "").replace("-EQ", "")
                out.append(row("Angel One", "equity", sym, sym, x.get("isin"), x["quantity"], x.get("averageprice"), x.get("ltp")))
        return out


BROKERS = {"zerodha": Zerodha(), "upstox": Upstox(), "angel": AngelOne()}

DEMO_HOLDINGS = [
    row("Demo", "equity", "TCS", "Tata Consultancy Services", "INE467B01029", 8, 3150, 2530),
    row("Demo", "equity", "ICICIBANK", "ICICI Bank", "INE090A01021", 40, 1180, 1394.2),
    row("Demo", "equity", "BEL", "Bharat Electronics", "INE263A01024", 150, 260, 0),
    row("Demo", "equity", "IRCTC", "Indian Railway Catering & Tourism", "INE335Y01020", 30, 820, 690),
    row("Demo", "mf", "INF879O01027", "Parag Parikh Flexi Cap Fund - Direct Growth", "INF879O01027", 512.4, 70.1, 88.97, 122639),
    row("Demo", "mf", "INF204K01K15", "Nippon India Small Cap Fund - Direct Growth", "INF204K01K15", 180.2, 140.5, 0, 118778),
]


def page(title, body):
    return (f"<!doctype html><meta charset='utf-8'><title>{title}</title>"
            "<body style='font:15px system-ui;max-width:560px;margin:60px auto;padding:0 16px'>"
            f"<h2>{title}</h2>{body}</body>").encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # keep tokens out of the console log
        sys.stderr.write("%s %s\n" % (self.command, urlparse(self.path).path))

    def cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        parts = [p for p in u.path.split("/") if p]
        try:
            if u.path == "/status":
                return self.send(200, {"ok": True, "demo": DEMO, "brokers": {
                    k: {"name": b.name, "configured": DEMO or b.ready(), "connected": DEMO or k in SESSIONS} for k, b in BROKERS.items()}})
            if parts[:1] == ["login"] and len(parts) == 2 and parts[1] in BROKERS:
                b = BROKERS[parts[1]]
                if DEMO:
                    return self.send(200, page("Demo mode", "<p>Demo holdings are always connected. Go back to BullScope and click <b>Sync holdings</b>.</p>"), "text/html")
                if not b.ready():
                    return self.send(400, page(f"{b.name} is not set up", "<p>Add your API key and secret to <code>connector/.env</code> "
                                                                          "(see <code>.env.example</code>) and restart the helper.</p>"), "text/html")
                state = secrets.token_urlsafe(16)
                STATES[state] = parts[1]
                self.send_response(302)
                self.send_header("Location", b.login_url(state))
                self.end_headers()
                return
            if parts[:1] == ["callback"] and len(parts) == 2 and parts[1] in BROKERS:
                key = parts[1]
                st = (q.get("state") or [""])[0]
                if not st:  # some brokers drop the state parameter: accept the latest pending login for this broker
                    st = next((k for k, v in reversed(STATES.items()) if v == key), "")
                if STATES.pop(st, None) != key:
                    return self.send(400, page("Login link expired", "<p>Start again from BullScope → My Portfolio → Connect.</p>"), "text/html")
                SESSIONS[key] = {"token": BROKERS[key].exchange(q), "at": time.time()}
                return self.send(200, page(f"{BROKERS[key].name} connected ✓",
                                           "<p>You can close this tab, go back to BullScope and click <b>Sync holdings</b>.</p>"
                                           "<p style='color:#666'>The access token stays in this helper's memory and is gone when you stop it. "
                                           "Brokers expire it daily.</p>"), "text/html")
            if u.path == "/holdings":
                if DEMO:
                    return self.send(200, {"holdings": DEMO_HOLDINGS, "errors": []})
                out, errors = [], []
                for k, s in SESSIONS.items():
                    try:
                        out += BROKERS[k].holdings(s["token"])
                    except Exception as e:  # one broker failing should not hide the others
                        errors.append(f"{BROKERS[k].name}: {e}")
                return self.send(200, {"holdings": out, "errors": errors})
            if u.path == "/logout":
                SESSIONS.clear()
                return self.send(200, {"ok": True})
            return self.send(404, {"error": "not found"})
        except requests.RequestException as e:
            return self.send(502, page("Broker did not respond", f"<p>{type(e).__name__}. Try again in a minute.</p>"), "text/html")


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    mode = "DEMO mode (sample holdings)" if DEMO else "live mode"
    print(f"BullScope connector running at {BASE} in {mode}. Press Ctrl+C to stop.")
    for k, b in BROKERS.items():
        print(f"  {b.name:10s} {'ready' if DEMO or b.ready() else 'not configured (add keys to connector/.env)'}"
              f"   redirect URL to register: {BASE}/callback/{k}")
    if "--no-browser" not in sys.argv:
        webbrowser.open(f"{BASE}/status")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("stopped")


if __name__ == "__main__":
    main()
