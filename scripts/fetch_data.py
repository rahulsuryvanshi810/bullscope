"""Download real market data into data/raw/.

Sources: Yahoo Finance (NSE .NS and BSE .BO prices, indices, fundamentals)
and api.mfapi.in (AMFI mutual fund NAV history). Needs internet.
"""
import time

import pandas as pd
import requests
import yfinance as yf

from config import FUNDS, INDICES, RAW, START_DATE, STOCKS


def long_format(df, names):
    """yfinance multi-ticker frame -> one row per (date, symbol)."""
    rows = []
    for yahoo, name in names.items():
        if yahoo not in df.columns.get_level_values(1):
            print(f"  no data for {yahoo}")
            continue
        part = df.xs(yahoo, axis=1, level=1).dropna(subset=["Close"]).copy()
        part["symbol"] = name
        rows.append(part.reset_index())
    out = pd.concat(rows, ignore_index=True)
    out.columns = [c.lower() for c in out.columns]
    return out


def fetch_prices():
    nse = {f"{s}.NS": s for s in STOCKS}
    print(f"NSE prices for {len(nse)} stocks since {START_DATE}")
    df = yf.download(list(nse), start=START_DATE, auto_adjust=True, progress=False, threads=True)
    prices = long_format(df, nse)
    prices[["date", "symbol", "open", "high", "low", "close", "volume"]].to_csv(RAW / "prices_nse.csv", index=False)

    bse = {f"{s}.BO": s for s in STOCKS}
    print("BSE prices (last 10 sessions)")
    df = yf.download(list(bse), period="10d", auto_adjust=True, progress=False, threads=True)
    long_format(df, bse)[["date", "symbol", "close", "volume"]].to_csv(RAW / "prices_bse.csv", index=False)

    print("Indices")
    df = yf.download(list(INDICES), start=START_DATE, auto_adjust=True, progress=False, threads=True)
    idx = long_format(df, INDICES)
    idx[["date", "symbol", "open", "high", "low", "close"]].to_csv(RAW / "indices.csv", index=False)


def fetch_fundamentals():
    print("Fundamentals and holder split")
    rows = []
    for s in STOCKS:
        try:
            info = yf.Ticker(f"{s}.NS").info
        except Exception as e:  # one bad ticker should not stop the run
            print(f"  {s}: {e}")
            info = {}
        rows.append({
            "symbol": s,
            "market_cap": info.get("marketCap"),
            "pe": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "eps": info.get("trailingEps"),
            "dividend_yield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "roe": info.get("returnOnEquity"),
            "debt_to_equity": info.get("debtToEquity"),
            "high_52w": info.get("fiftyTwoWeekHigh"),
            "low_52w": info.get("fiftyTwoWeekLow"),
            "insiders_pct": info.get("heldPercentInsiders"),
            "institutions_pct": info.get("heldPercentInstitutions"),
            "shares_outstanding": info.get("sharesOutstanding"),
        })
        time.sleep(0.3)
    pd.DataFrame(rows).to_csv(RAW / "fundamentals.csv", index=False)


def fetch_mutual_funds():
    print(f"Mutual fund NAVs for {len(FUNDS)} schemes")
    navs, meta = [], []
    for code, aum in FUNDS.items():
        r = requests.get(f"https://api.mfapi.in/mf/{code}", timeout=60).json()
        m = r["meta"]
        meta.append({
            "scheme_code": code,
            "scheme_name": m["scheme_name"],
            "fund_house": m["fund_house"],
            "category": m["scheme_category"],
            "aum_cr_approx": aum,
        })
        nav = pd.DataFrame(r["data"])
        nav["scheme_code"] = code
        navs.append(nav)
        time.sleep(0.2)
    nav = pd.concat(navs, ignore_index=True)
    nav["date"] = pd.to_datetime(nav["date"], format="%d-%m-%Y")
    nav["nav"] = nav["nav"].astype(float)
    nav = nav[nav["date"] >= "2019-01-01"].sort_values(["scheme_code", "date"])
    nav.to_csv(RAW / "mf_nav.csv", index=False)
    pd.DataFrame(meta).to_csv(RAW / "mf_meta.csv", index=False)


if __name__ == "__main__":
    RAW.mkdir(parents=True, exist_ok=True)
    fetch_prices()
    fetch_mutual_funds()
    fetch_fundamentals()
    print("done")
