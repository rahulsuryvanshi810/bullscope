# BullScope connector: link your demat account

BullScope can read your holdings in two ways. Both put them on the **My Portfolio** page, where you get value,
profit/loss, risk, a 12-month prediction and suggestions.

## 1. File import (any broker, no setup)

Download your holdings file from the broker and click **Choose holdings file** on the My Portfolio page.
The file is read inside your browser and never uploaded.

| Broker | Where to download |
|---|---|
| Zerodha | Kite → Portfolio → Holdings → Download (CSV), or Console → Portfolio → Holdings → Download (XLSX, includes mutual funds) |
| Groww | Profile → Reports → Stocks holdings statement / Mutual funds holdings statement (XLSX) |
| Upstox | Portfolio → Holdings → Download, or Reports → Holdings statement |
| Angel One | Portfolio → Holdings → Download, or Reports → Holdings statement |

Sample files to try: `docs/samples/zerodha_kite_holdings_sample.csv`, `docs/samples/groww_mutual_funds_sample.csv`.

Stocks in the NIFTY 50 and mutual funds that can be matched to an AMFI scheme get the full analysis. Anything else is
kept at the price in your file and treated as flat in the prediction.

## 2. Live sync through the official broker APIs (Zerodha, Upstox, Angel One)

`bullscope_connector.py` is a small helper that runs **only on your PC** at `http://127.0.0.1:8766`.

How it keeps your account safe:
- You log in on the **broker's own website**. BullScope and the helper never see your password, PIN or OTP.
- The helper receives a short-lived access token from the broker's redirect, keeps it **in memory only**, and it is
  gone when you stop the helper (brokers also expire it every day).
- Your API secret stays in `connector/.env` on your PC. That file is git-ignored.
- The helper only reads holdings. It has no code that places orders or moves money.
- Only the BullScope pages listed in `ALLOWED_ORIGINS` can read from it.

### Setup (once)
1. Create a developer app with your broker and set its redirect URL:

   | Broker | Developer portal | Redirect URL |
   |---|---|---|
   | Zerodha | https://developers.kite.trade (Kite Connect) | `http://127.0.0.1:8766/callback/zerodha` |
   | Upstox | https://account.upstox.com/developer/apps | `http://127.0.0.1:8766/callback/upstox` |
   | Angel One | https://smartapi.angelone.in (Publisher app) | `http://127.0.0.1:8766/callback/angel` |

   Check the broker's current pricing and terms for API access before you sign up.
2. Copy `.env.example` to `.env` and paste your API key (and secret for Zerodha / Upstox).

### Every time
```bash
cd connector
python bullscope_connector.py
```
Then on BullScope → My Portfolio: click **Log in** next to your broker, finish the login on the broker's page,
come back and click **Sync holdings**. Synced holdings replace that broker's earlier sync.

Try it without any broker account: `python bullscope_connector.py --demo`.

Groww does not offer a personal API, so use the file import for Groww.

### Endpoints
| Path | What it does |
|---|---|
| `/status` | which brokers are configured and logged in |
| `/login/<broker>` | sends you to the broker's login page |
| `/callback/<broker>` | receives the broker's redirect and creates the session |
| `/holdings` | your holdings from every logged-in broker, in one list |
| `/logout` | forgets all tokens |
