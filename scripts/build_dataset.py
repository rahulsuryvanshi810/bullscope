"""Turn data/raw/ into analysis tables (data/processed/) and the web dashboard data (docs/data.js).

Real data: stock and index prices, BSE quotes, fundamentals, mutual fund NAVs.
Modelled data (no free public source): option chain OI and IV smile, FII/DII
daily flows, fund portfolio holdings. Every modelled table carries is_modelled = 1.
"""
import json
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from config import DOCS, FNO, PROCESSED, RAW, RISK_FREE, STOCKS
from holdings_universe import MIDCAPS, SMALLCAPS

rng = np.random.default_rng(42)


# ---------------------------------------------------------------- load
def load():
    px = pd.read_csv(RAW / "prices_nse.csv", parse_dates=["date"])
    idx = pd.read_csv(RAW / "indices.csv", parse_dates=["date"])
    bse = pd.read_csv(RAW / "prices_bse.csv", parse_dates=["date"])
    fund = pd.read_csv(RAW / "fundamentals.csv")
    nav = pd.read_csv(RAW / "mf_nav.csv", parse_dates=["date"])
    meta = pd.read_csv(RAW / "mf_meta.csv")
    return px, idx, bse, fund, nav, meta


# ---------------------------------------------------------------- technicals
def rsi(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def features(g):
    c, v = g["close"], g["volume"]
    f = pd.DataFrame(index=g.index)
    f["rsi"] = rsi(c)
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    f["macd_hist"] = (macd - macd.ewm(span=9, adjust=False).mean()) / c
    f["sma50_gap"] = c / c.rolling(50).mean() - 1
    f["sma200_gap"] = c / c.rolling(200).mean() - 1
    f["trend"] = c.rolling(50).mean() / c.rolling(200).mean() - 1
    f["mom21"] = c / c.shift(21) - 1
    f["mom63"] = c / c.shift(63) - 1
    f["vol21"] = np.log(c).diff().rolling(21).std() * np.sqrt(252)
    f["dist_52w_high"] = c / c.rolling(252, min_periods=120).max() - 1
    f["volume_ratio"] = v / v.rolling(20).mean()
    f["fwd20"] = c.shift(-20) / c - 1
    return f


def rule_score(r):
    s = (1 if r.sma50_gap > 0 else -1) + (1 if r.trend > 0 else -1) + (1 if r.macd_hist > 0 else -1)
    s += 1 if r.rsi < 30 else (-1 if r.rsi > 70 else 0)
    s += 1 if r.mom63 > 0.05 else (-1 if r.mom63 < -0.05 else 0)
    return s


def label(score):
    if score >= 3:
        return "Strong Buy"
    if score >= 1:
        return "Buy"
    if score == 0:
        return "Hold"
    if score >= -2:
        return "Sell"
    return "Strong Sell"


FEATS = ["rsi", "macd_hist", "sma50_gap", "sma200_gap", "trend", "mom21", "mom63", "vol21", "dist_52w_high", "volume_ratio"]


def stock_signals(px):
    frames = []
    for sym, g in px.groupby("symbol"):
        g = g.sort_values("date").set_index("date")
        f = features(g)
        f["symbol"] = sym
        frames.append(f)
    allf = pd.concat(frames).reset_index()
    ready = allf.dropna(subset=FEATS)

    # rule-score backtest: forward 20-session return after each signal, sampled weekly
    bt = ready.dropna(subset=["fwd20"]).iloc[::5].copy()
    bt["score"] = bt.apply(rule_score, axis=1)
    bt["signal"] = bt["score"].map(label)
    backtest = (bt.groupby("signal")["fwd20"]
                .agg(n="count", avg_fwd20="mean", hit_rate=lambda x: (x > 0).mean())
                .reindex(["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]).reset_index())

    # ML: does the next 20 sessions close higher? walk-forward split with a 20-session gap
    ml = ready.dropna(subset=["fwd20"]).iloc[::3].copy()
    ml["y"] = (ml["fwd20"] > 0).astype(int)
    dates = np.sort(ml["date"].unique())
    cut = dates[int(len(dates) * 0.7)]
    gap = dates[min(int(len(dates) * 0.7) + 20, len(dates) - 1)]
    tr, te = ml[ml["date"] < cut], ml[ml["date"] > gap]
    models = {
        "Logistic regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=500)),
        "Gradient boosting": HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200,
                                                            l2_regularization=1.0, random_state=0),
    }
    ml_report = {"train_rows": len(tr), "test_rows": len(te), "test_from": str(pd.Timestamp(gap).date()),
                 "base_rate": round(float(te["y"].mean()), 3), "models": []}
    best, best_auc = None, -1
    for name, m in models.items():
        m.fit(tr[FEATS], tr["y"])
        p = m.predict_proba(te[FEATS])[:, 1]
        auc = roc_auc_score(te["y"], p)
        ml_report["models"].append({"name": name, "accuracy": round(accuracy_score(te["y"], p > 0.5), 3),
                                    "auc": round(auc, 3)})
        if auc > best_auc:
            best, best_auc = name, auc
    ml_report["chosen"] = best
    final = models[best].fit(ml[FEATS], ml["y"])

    latest = ready.sort_values("date").groupby("symbol").tail(1).copy()
    latest["score"] = latest.apply(rule_score, axis=1)
    latest["signal"] = latest["score"].map(label)
    latest["p_up_20d"] = final.predict_proba(latest[FEATS])[:, 1]
    return latest, backtest, ml_report


def monte_carlo(close, horizon, lookback, step, n=3000):
    r = np.log(close).diff().dropna().values[-lookback:]
    sims = rng.choice(r, size=(n, horizon)).cumsum(axis=1)
    paths = close.iloc[-1] * np.exp(sims)
    qs = np.percentile(paths[:, step - 1::step], [5, 25, 50, 75, 95], axis=0)
    final = paths[:, -1] / close.iloc[-1] - 1
    return {"step": step, "p5": qs[0].round(2).tolist(), "p25": qs[1].round(2).tolist(),
            "p50": qs[2].round(2).tolist(), "p75": qs[3].round(2).tolist(), "p95": qs[4].round(2).tolist(),
            "prob_up": round(float((final > 0).mean()), 3),
            "exp_return": round(float(np.median(final)), 4)}


# ---------------------------------------------------------------- mutual funds
CATEGORY_MAP = [
    ("Large & Mid", "Large & Mid Cap"), ("Small Cap", "Small Cap"), ("Mid Cap", "Mid Cap"), ("Large Cap", "Large Cap"),
    ("Flexi Cap", "Flexi Cap"), ("Multi Cap", "Multi Cap"), ("Focused", "Focused"), ("ELSS", "ELSS (Tax Saver)"),
    ("Value", "Value"), ("Contra", "Contra"), ("Balanced Advantage", "Balanced Advantage"),
    ("Multi Asset", "Multi Asset"), ("Arbitrage", "Arbitrage"), ("Conservative Hybrid", "Conservative Hybrid"),
    ("Sectoral", "Sectoral / Thematic"), ("Thematic", "Sectoral / Thematic"), ("Liquid", "Liquid"), ("Corporate Bond", "Corporate Bond"),
    ("Short Duration", "Short Duration"), ("Short Term", "Short Duration"),
]
ASSET_CLASS = {"Liquid": "Debt", "Corporate Bond": "Debt", "Short Duration": "Debt",
               "Balanced Advantage": "Hybrid", "Multi Asset": "Hybrid", "Arbitrage": "Hybrid", "Conservative Hybrid": "Hybrid",
               "Gold": "Gold & International", "International": "Gold & International"}


def clean_category(raw, name):
    low = name.lower()
    if "gold" in low:
        return "Gold"
    if "nasdaq" in low:
        return "International"
    if "Index" in raw:
        return "Index - Small Cap" if "smallcap" in low else ("Index - Mid Cap" if "midcap" in low else "Index - Large Cap")
    for key, val in CATEGORY_MAP:
        if key.lower() in raw.lower():
            return val
    return raw


KEEP_UPPER = {"HDFC", "ICICI", "ELSS", "NASDAQ", "SBI", "UTI", "DSP", "JM", "PPFAS"}


def short_name(n):
    for cut in [" - Direct", " Direct", "- Direct"]:
        if cut in n:
            n = n.split(cut)[0]
    n = n.replace("(erstwhile Bluechip Fund)", "").replace("(erstwhile Value Discovery Fund)", "")
    n = n.replace("UTI - ", "UTI ").replace("Fund.", "Fund").strip(" -.")
    words = [w if w in KEEP_UPPER or not (w.isupper() and len(w) > 2) else w.capitalize() for w in n.split()]
    return " ".join(words).replace("Elss", "ELSS").replace("ELSS-", "ELSS").strip()


def nav_on(s, d):
    s = s[s.index <= d]
    return s.iloc[-1] if len(s) else np.nan


def xirr(flows, dates):
    t = np.array([(d - dates[0]).days / 365 for d in dates])
    f = np.array(flows)
    lo, hi = -0.99, 5.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if (f / (1 + mid) ** t).sum() > 0:
            lo = mid
        else:
            hi = mid
    return mid


def fund_metrics(nav, meta, nifty):
    rows, series = [], {}
    nifty_r = np.log(nifty).diff()
    for _, m in meta.iterrows():
        s = nav[nav["scheme_code"] == m.scheme_code].set_index("date")["nav"].sort_index()
        asof = s.index[-1]
        last = s.iloc[-1]
        ret = {}
        for key, days in [("r1m", 30), ("r3m", 91), ("r6m", 182), ("r1y", 365)]:
            ret[key] = last / nav_on(s, asof - timedelta(days=days)) - 1
        for key, yrs in [("cagr3y", 3), ("cagr5y", 5)]:
            past = nav_on(s, asof - timedelta(days=int(365.25 * yrs)))
            ret[key] = (last / past) ** (1 / yrs) - 1 if past == past else np.nan
        s3 = s[s.index > asof - timedelta(days=int(365.25 * 3))]
        r3 = np.log(s3).diff().dropna()
        vol = r3.std() * np.sqrt(252)
        downside = r3[r3 < 0].std() * np.sqrt(252)
        dd = (s3 / s3.cummax() - 1).min()
        both = pd.concat([r3, nifty_r], axis=1, join="inner").dropna()
        beta = both.cov().iloc[0, 1] / both.iloc[:, 1].var()
        roll = (s3 / s3.shift(250) - 1).dropna()
        # SIP: Rs 10,000 on the first NAV date of each of the last 36 months
        months = s3.groupby(s3.index.to_period("M")).head(1).iloc[-36:]
        units = (10000 / months).sum()
        sip_value = units * last
        flows = [-10000] * len(months) + [sip_value]
        sip_xirr = xirr(flows, list(months.index) + [asof])
        cat = clean_category(m.category, m.scheme_name)
        rows.append({
            "scheme_code": m.scheme_code, "fund": short_name(m.scheme_name), "fund_house": m.fund_house,
            "category": cat, "asset_class": ASSET_CLASS.get(cat, "Equity"),
            "aum_cr_approx": m.aum_cr_approx, "nav": last, "nav_date": asof.date().isoformat(), **ret,
            "volatility": vol, "sharpe": (ret["cagr3y"] - RISK_FREE) / vol, "sortino": (ret["cagr3y"] - RISK_FREE) / downside,
            "max_drawdown": dd, "beta": beta, "roll1y_median": roll.median(), "roll1y_min": roll.min(),
            "roll1y_pct_positive": (roll > 0).mean(), "sip_invested": 10000 * len(months),
            "sip_value": sip_value, "sip_xirr": sip_xirr,
        })
        series[int(m.scheme_code)] = s
    df = pd.DataFrame(rows)

    # score equity funds against each other; debt funds against each other
    def pct(col, asc=True):
        return df.groupby("asset_class")[col].rank(pct=True, ascending=asc)
    df["score"] = (0.30 * pct("cagr3y") + 0.25 * pct("sharpe") + 0.10 * pct("sortino") + 0.15 * pct("max_drawdown")
                   + 0.10 * pct("roll1y_pct_positive") + 0.10 * pct("r1y")) * 100
    df["stars"] = np.clip(np.ceil(df["score"] / 20), 1, 5).astype(int)
    df["recommendation"] = pd.cut(df["score"], [-1, 40, 55, 75, 101], labels=["Review", "Hold", "Buy", "Strong Buy"]).astype(str)
    df["risk"] = pd.cut(df["volatility"], [-1, 0.03, 0.10, 0.14, 0.17, 9],
                        labels=["Low", "Moderate", "Moderately High", "High", "Very High"]).astype(str)
    return df, series


def model_portfolios(fm):
    def best(cats):
        sub = fm[fm["category"].isin(cats)].sort_values("score", ascending=False)
        return sub.iloc[0]
    plans = {
        "Conservative": [("Debt", ["Corporate Bond"], 30), ("Liquid / emergency", ["Liquid"], 10),
                         ("Balanced Advantage", ["Balanced Advantage"], 30), ("Large Cap / Index", ["Large Cap", "Index - Large Cap"], 30)],
        "Moderate": [("Large Cap / Index", ["Large Cap", "Index - Large Cap"], 30), ("Flexi Cap", ["Flexi Cap"], 30),
                     ("Mid Cap", ["Mid Cap", "Index - Mid Cap"], 20), ("Balanced Advantage", ["Balanced Advantage"], 10), ("Debt", ["Corporate Bond"], 10)],
        "Aggressive": [("Flexi Cap", ["Flexi Cap"], 25), ("Mid Cap", ["Mid Cap", "Index - Mid Cap"], 30),
                       ("Small Cap", ["Small Cap"], 30), ("Thematic", ["Sectoral / Thematic"], 15)],
    }
    out = {}
    for name, legs in plans.items():
        items = []
        for bucket, cats, w in legs:
            f = best(cats)
            items.append({"bucket": bucket, "weight": w, "scheme_code": int(f.scheme_code), "fund": f.fund,
                          "cagr3y": round(float(f.cagr3y), 4), "score": round(float(f.score), 1)})
        exp = sum(i["weight"] / 100 * i["cagr3y"] for i in items)
        out[name] = {"items": items, "blended_cagr3y": round(exp, 4)}
    return out


# ---------------------------------------------------------------- modelled: fund holdings
def model_holdings(fm, fund_df):
    large = {s: (STOCKS[s][0], STOCKS[s][1], fund_df.loc[s, "market_cap"] / 1e7) for s in STOCKS}
    pools = {"L": large, "M": MIDCAPS, "S": SMALLCAPS}
    mix = {
        "Large Cap": {"L": 0.85, "M": 0.15}, "Index - Large Cap": {"L": 1.0}, "Flexi Cap": {"L": 0.65, "M": 0.25, "S": 0.10},
        "Large & Mid Cap": {"L": 0.55, "M": 0.40, "S": 0.05}, "Multi Cap": {"L": 0.40, "M": 0.30, "S": 0.30},
        "Focused": {"L": 0.75, "M": 0.20, "S": 0.05},
        "Mid Cap": {"L": 0.10, "M": 0.75, "S": 0.15}, "Index - Mid Cap": {"M": 1.0}, "Small Cap": {"L": 0.05, "M": 0.20, "S": 0.75},
        "Index - Small Cap": {"S": 1.0},
        "ELSS (Tax Saver)": {"L": 0.70, "M": 0.20, "S": 0.10}, "Value": {"L": 0.80, "M": 0.15, "S": 0.05},
        "Contra": {"L": 0.75, "M": 0.15, "S": 0.10}, "Balanced Advantage": {"L": 0.90, "M": 0.10},
    }
    themes = [(("pharma", "health"), {"Pharma", "Healthcare"}), (("technology", "digital"), {"IT", "Telecom"}),
              (("bank", "financial"), {"Banking", "Financial Services"}),
              (("infra", "power"), {"Infrastructure", "Power", "Capital Goods", "Cement", "Energy", "Industrials"}),
              (("defence",), {"Defence", "Capital Goods", "Industrials", "Infrastructure"})]
    rows = []
    for _, f in fm[fm["category"].isin(set(mix) | {"Sectoral / Thematic"})].iterrows():
        equity_share = 0.65 if f.category == "Balanced Advantage" else 0.96
        if f.category == "Sectoral / Thematic":
            sectors = next(sec for keys, sec in themes if any(k in f.fund.lower() for k in keys))
            cand = {k: v for p in pools.values() for k, v in p.items() if v[1] in sectors}
            if "IT" in sectors:
                cand["ETERNAL"] = large["ETERNAL"]
            legs = [(cand, 1.0, len(cand))]
        else:
            n_total = int(rng.integers(32, 60))
            legs = [(pools[k], w, max(3, int(round(n_total * w)))) for k, w in mix[f.category].items()]
        weights = {}
        for pool, w, n in legs:
            keys = list(pool)
            cap = np.array([pool[k][2] for k in keys], dtype=float)
            if f.category.startswith("Index"):
                pick = keys
                raw = cap
            else:
                prob = cap ** 0.6 / (cap ** 0.6).sum()
                pick = list(rng.choice(keys, size=min(n, len(keys)), replace=False, p=prob))
                raw = np.array([pool[k][2] for k in pick]) ** 0.5 * rng.lognormal(0, 0.45, len(pick))
            raw = raw / raw.sum() * w
            for k, x in zip(pick, raw):
                weights[k] = weights.get(k, 0) + x
        aum_eq = f.aum_cr_approx * equity_share
        mcaps = {k: v[2] for p in pools.values() for k, v in p.items()}

        def cap_weights(w):
            # SEBI caps a scheme at 10% of a company; keep modelled stakes under ~4% and weights under 9.5%
            limit = pd.Series({k: min(0.095, mcaps[k] * 0.04 / aum_eq) for k in w.index})
            w = w / w.sum()
            for _ in range(50):
                over = w > limit
                if not over.any():
                    break
                spare = (w[over] - limit[over]).sum()
                w[over] = limit[over]
                free = ~over & (w < limit)
                w[free] += spare * w[free] / w[free].sum()
            return w

        prev = cap_weights(pd.Series(weights))
        # current month: re-weight, a few exits and new entries
        curr = prev * rng.lognormal(0, 0.12, len(prev))
        if not f.category.startswith("Index") and f.category != "Sectoral / Thematic":
            exits = rng.choice(curr.index, size=2, replace=False)
            curr = curr.drop(exits)
            all_names = [k for p in pools.values() for k in p if k not in prev.index]
            news = rng.choice(all_names, size=2, replace=False)
            for k in news:
                curr[k] = curr.mean() * 0.6
        curr = cap_weights(curr)
        for k in sorted(set(prev.index) | set(curr.index)):
            name, sector, mcap = next(p[k] for p in pools.values() if k in p)
            wp, wc = float(prev.get(k, 0)), float(curr.get(k, 0))
            vp, vc = wp * aum_eq * 0.97, wc * aum_eq  # prior month AUM ~3% lower
            change = "New" if wp == 0 else ("Exit" if wc == 0 else ("Increased" if vc > vp * 1.03 else ("Reduced" if vc < vp * 0.97 else "Unchanged")))
            rows.append({"scheme_code": int(f.scheme_code), "fund": f.fund, "fund_house": f.fund_house, "symbol": k,
                         "company": name, "sector": sector, "cap_bucket": "Large" if k in large else ("Mid" if k in MIDCAPS else "Small"),
                         "weight_pct": round(wc * 100, 2), "value_cr": round(vc, 1), "prev_value_cr": round(vp, 1),
                         "change_cr": round(vc - vp, 1), "change": change,
                         "stake_pct": round(vc / mcap * 100, 3), "is_modelled": 1})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- modelled: options
def last_tuesday(y, m):
    d = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - 1) % 7)


def expiries(asof, weekly):
    if weekly:
        d = asof + timedelta(days=(1 - asof.weekday()) % 7 or 7)
        return [d + timedelta(weeks=i) for i in range(4)]
    out, y, m = [], asof.year, asof.month
    while len(out) < 3:
        e = last_tuesday(y, m)
        if e > asof:
            out.append(e)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def bs(S, K, T, r, sig, kind):
    d1 = (np.log(S / K) + (r + sig ** 2 / 2) * T) / (sig * np.sqrt(T))
    d2 = d1 - sig * np.sqrt(T)
    if kind == "CE":
        price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        delta = norm.cdf(d1)
        theta = (-S * norm.pdf(d1) * sig / (2 * np.sqrt(T)) - r * K * np.exp(-r * T) * norm.cdf(d2)) / 365
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta = norm.cdf(d1) - 1
        theta = (-S * norm.pdf(d1) * sig / (2 * np.sqrt(T)) + r * K * np.exp(-r * T) * norm.cdf(-d2)) / 365
    gamma = norm.pdf(d1) / (S * sig * np.sqrt(T))
    vega = S * norm.pdf(d1) * np.sqrt(T) / 100
    return price, delta, gamma, theta, vega


def option_chains(px, idx):
    vix = idx[idx.symbol == "INDIA VIX"].sort_values("date")["close"].iloc[-1] / 100
    asof = px["date"].max().date()
    out, flat = {}, []
    for name, (src, step, lot) in FNO.items():
        is_index = src.startswith("^")
        if is_index:
            disp = {"^NSEI": "NIFTY 50", "^NSEBANK": "NIFTY BANK"}[src]
            closes = idx[idx.symbol == disp].sort_values("date").set_index("date")["close"]
            base_iv = vix * (1.0 if name == "NIFTY" else 1.15)
            base_oi = 110000 if name == "NIFTY" else 45000
        else:
            closes = px[px.symbol == src].sort_values("date").set_index("date")["close"]
            base_iv = np.log(closes).diff().iloc[-30:].std() * np.sqrt(252) * 1.1
            base_oi = 4000
        S = float(closes.iloc[-1])
        atm = round(S / step) * step
        n = 20 if is_index else 15
        strikes = [atm + i * step for i in range(-n, n + 1)]
        exps = []
        for j, e in enumerate(expiries(asof, weekly=(name == "NIFTY"))):
            days = (e - asof).days
            T = max(days, 0.5) / 365
            near = 1 / (1 + 0.6 * j)
            chain = []
            for K in strikes:
                mny = np.log(K / S)
                iv = float(np.clip(base_iv * (1 - 1.6 * mny + 14 * mny ** 2), 0.06, 1.2))
                x = (K - S) / S
                round_bump = 1.8 if K % (step * 10) == 0 else (1.3 if K % (step * 2) == 0 else 1.0)
                row = {"strike": K}
                for kind, centre in [("CE", 0.025), ("PE", -0.025)]:
                    price, delta, gamma, theta, vega = bs(S, K, T, RISK_FREE, iv, kind)
                    oi = base_oi * near * (np.exp(-((x - centre) / 0.04) ** 2) + 0.05) * round_bump * rng.lognormal(0, 0.25)
                    chg = oi * rng.normal(0.06, 0.22)
                    volu = oi * (2.5 * np.exp(-(x / 0.02) ** 2) + 0.3) * rng.lognormal(0, 0.3)
                    row[kind] = {"ltp": round(max(price, 0.05), 2), "iv": round(iv * 100, 2), "oi": int(oi),
                                 "chg_oi": int(chg), "volume": int(volu), "delta": round(delta, 3),
                                 "gamma": round(gamma, 6), "theta": round(theta, 2), "vega": round(vega, 2)}
                    flat.append({"underlying": name, "expiry": e.isoformat(), "strike": K, "type": kind, **row[kind],
                                 "spot": round(S, 2), "lot_size": lot, "is_modelled": 1})
                chain.append(row)
            ce_oi = sum(r["CE"]["oi"] for r in chain)
            pe_oi = sum(r["PE"]["oi"] for r in chain)
            pain = {K: sum(max(0, K - r["strike"]) * r["CE"]["oi"] + max(0, r["strike"] - K) * r["PE"]["oi"]
                           for r in chain) for K in strikes}
            exps.append({"expiry": e.isoformat(), "days": days, "chain": chain, "pcr": round(pe_oi / ce_oi, 3),
                         "max_pain": min(pain, key=pain.get), "ce_oi": ce_oi, "pe_oi": pe_oi,
                         "atm_iv": round(base_iv * 100, 2)})
        # OI build-up for the nearest expiry over the last 15 sessions (spot is real)
        hist = []
        tail = closes.iloc[-15:]
        for i, (d, c) in enumerate(tail.items()):
            f = 0.45 + 0.55 * (i + 1) / len(tail)
            hist.append({"date": d.date().isoformat(), "spot": round(float(c), 2),
                         "ce_oi": int(exps[0]["ce_oi"] * f * rng.lognormal(0, 0.04)),
                         "pe_oi": int(exps[0]["pe_oi"] * f * rng.lognormal(0, 0.04))})
        out[name] = {"spot": round(S, 2), "step": step, "lot": lot, "is_index": is_index,
                     "fut": round(S * np.exp(RISK_FREE * max(exps[0]["days"], 0.5) / 365), 2),
                     "expiries": exps, "oi_history": hist}
    return out, pd.DataFrame(flat)


# ---------------------------------------------------------------- modelled: FII / DII
def fii_dii(idx):
    n = idx[idx.symbol == "NIFTY 50"].sort_values("date").set_index("date")["close"]
    r = n.pct_change().fillna(0)
    k = len(r)
    fii_net = 2600 * (r / 0.009) + rng.normal(-450, 2300, k)
    dii_net = -0.55 * fii_net + rng.normal(1900, 1500, k)
    fii_buy = 12500 + np.abs(rng.normal(0, 3500, k))
    dii_buy = 11000 + np.abs(rng.normal(0, 3000, k))
    return pd.DataFrame({"date": n.index, "fii_buy": fii_buy.round(2), "fii_sell": (fii_buy - fii_net).round(2),
                         "fii_net": fii_net.round(2), "dii_buy": dii_buy.round(2), "dii_sell": (dii_buy - dii_net).round(2),
                         "dii_net": dii_net.round(2), "nifty_close": n.values.round(2), "is_modelled": 1})


# ---------------------------------------------------------------- corporate actions
# Yahoo adjusts splits and dividends but not demergers. Tata Motors demerged its CV business
# (record date 14 Oct 2025); scale earlier prices so the passenger-vehicle series has no false crash.
DEMERGERS = {"TMPV": "2025-10-14"}
JUMPS = []


def adjust_corporate_actions(px):
    px = px.copy()
    for sym, day in DEMERGERS.items():
        g = px[px.symbol == sym].set_index("date")["close"]
        day = pd.Timestamp(day)
        if day not in g.index:
            continue
        factor = g.loc[day] / g[g.index < day].iloc[-1]
        mask = (px.symbol == sym) & (px.date < day)
        px.loc[mask, ["open", "high", "low", "close"]] *= factor
        px.loc[mask, "volume"] = (px.loc[mask, "volume"] / factor).round()
    # list any remaining one-day moves over 25% so the dashboard can flag them
    r = px.groupby("symbol")["close"].pct_change()
    for _, row in px[r.abs() > 0.25].assign(r=r).iterrows():
        JUMPS.append({"symbol": row.symbol, "date": row.date.date().isoformat(), "move": round(float(row.r), 4)})
    return px


# ---------------------------------------------------------------- main
def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    px, idx, bse, fund, nav, meta = load()
    fund = fund.set_index("symbol")
    px = px.sort_values(["symbol", "date"])
    px = adjust_corporate_actions(px)

    # money flow: share of each day's volume that closed near the high (buying) vs the low (selling)
    rng_hl = (px["high"] - px["low"]).replace(0, np.nan)
    clv = ((px["close"] - px["low"]) - (px["high"] - px["close"])) / rng_hl
    px["daily_return"] = px.groupby("symbol")["close"].pct_change().round(6)
    px["turnover_cr"] = px["close"] * px["volume"] / 1e7
    px["buy_value_cr"] = (px["turnover_cr"] * (1 + clv.fillna(0)) / 2).round(3)
    px["sell_value_cr"] = (px["turnover_cr"] - px["buy_value_cr"]).round(3)

    latest, backtest, ml_report = stock_signals(px)
    latest = latest.set_index("symbol")
    calendar = sorted(px["date"].unique())
    cal_idx = {d: i for i, d in enumerate(calendar)}

    stocks_js, prices_js, stocks_tbl = [], {}, []
    bse_last = bse.sort_values("date").groupby("symbol").tail(1).set_index("symbol")
    for sym, (name, sector) in STOCKS.items():
        g = px[px.symbol == sym].set_index("date")
        if g.empty:
            continue
        # align to the shared trading calendar; a missing session repeats the last close with zero volume
        g = g.reindex([d for d in calendar if d >= g.index[0]])
        g["close"] = g["close"].ffill()
        for col in ["open", "high", "low"]:
            g[col] = g[col].fillna(g["close"])
        g["volume"] = g["volume"].fillna(0)
        f = fund.loc[sym]
        L = latest.loc[sym]
        mc = monte_carlo(g["close"], 60, 252, 5)
        start = cal_idx[g.index[0]]
        prices_js[sym] = {"s": start, **{k: g[col].round(2).tolist() for k, col in
                                         [("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")]},
                          "v": g["volume"].astype(int).tolist()}
        row = {
            "sym": sym, "name": name, "sector": sector,
            "mcap_cr": round(f.market_cap / 1e7), "pe": f.pe, "pb": f.pb, "eps": f.eps,
            "div_yield": f.dividend_yield, "beta": f.beta, "roe": f.roe, "de": f.debt_to_equity,
            "high_52w": f.high_52w, "low_52w": f.low_52w,
            "promoter_pct": f.insiders_pct, "institutions_pct": f.institutions_pct,
            "public_pct": max(0.0, 1 - f.insiders_pct - f.institutions_pct),
            "bse_close": float(bse_last.loc[sym, "close"]) if sym in bse_last.index else None,
            "rsi": L.rsi, "score": int(L.score), "signal": L.signal, "p_up_20d": L.p_up_20d,
            "macd_hist": L.macd_hist, "sma50_gap": L.sma50_gap, "sma200_gap": L.sma200_gap, "mom63": L.mom63, "vol21": L.vol21,
            "mc": mc,
        }
        stocks_js.append({k: (round(v, 4) if isinstance(v, float) else (None if v is pd.NA else v))
                          for k, v in row.items()})
        stocks_tbl.append({k: v for k, v in row.items() if k != "mc"} | {"mc_exp_return_60d": mc["exp_return"],
                                                                        "mc_prob_up_60d": mc["prob_up"]})

    indices_js = {}
    for sym, g in idx.groupby("symbol"):
        g = g.set_index("date").reindex(calendar)
        indices_js[sym] = g["close"].round(2).where(g["close"].notna(), None).tolist()

    nifty = idx[idx.symbol == "NIFTY 50"].set_index("date")["close"].sort_index()
    fm, series = fund_metrics(nav, meta, nifty)
    portfolios = model_portfolios(fm)
    holdings = model_holdings(fm, fund)
    fm_proj = {}
    nav_js = {}
    epoch = pd.Timestamp("2019-01-01")
    for code, s in series.items():
        s5 = s[s.index > s.index[-1] - timedelta(days=int(365.25 * 5) + 10)]
        nav_js[code] = {"d": ((s5.index - epoch).days).tolist(), "n": s5.round(4).tolist()}
        fm_proj[code] = monte_carlo(s, 252, 756, 21)
    chains, chain_tbl = option_chains(px, idx)
    flows = fii_dii(idx)

    # ---- CSVs for Power BI / Tableau
    pd.DataFrame(stocks_tbl).to_csv(PROCESSED / "dim_stock.csv", index=False)
    px[["date", "symbol", "open", "high", "low", "close", "volume", "daily_return", "turnover_cr", "buy_value_cr", "sell_value_cr"]] \
        .to_csv(PROCESSED / "fact_stock_prices.csv", index=False)
    idx.to_csv(PROCESSED / "fact_index_prices.csv", index=False)
    cal = pd.DataFrame({"date": pd.date_range(min(calendar), max(calendar))})
    cal["year"], cal["quarter"] = cal.date.dt.year, "Q" + cal.date.dt.quarter.astype(str)
    cal["month"], cal["month_name"] = cal.date.dt.month, cal.date.dt.strftime("%b")
    cal["weekday"], cal["is_trading_day"] = cal.date.dt.day_name(), cal.date.isin(calendar).astype(int)
    cal.to_csv(PROCESSED / "dim_date.csv", index=False)
    fm.to_csv(PROCESSED / "dim_fund.csv", index=False)
    nav.merge(fm[["scheme_code", "fund"]]).to_csv(PROCESSED / "fact_fund_nav.csv", index=False)
    holdings.to_csv(PROCESSED / "fact_fund_holdings.csv", index=False)
    chain_tbl.to_csv(PROCESSED / "fact_option_chain.csv", index=False)
    flows.to_csv(PROCESSED / "fact_fii_dii.csv", index=False)
    backtest.to_csv(PROCESSED / "signal_backtest.csv", index=False)

    # ---- web data
    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (float, np.floating)):
            return None if np.isnan(o) else round(float(o), 4)
        return o

    funds_js = []
    for r in fm.to_dict("records"):
        r["proj"] = fm_proj[r["scheme_code"]]
        funds_js.append(r)
    data = {
        "meta": {"as_of": pd.Timestamp(max(calendar)).date().isoformat(), "generated": date.today().isoformat(), "jumps": JUMPS,
                 "risk_free": RISK_FREE},
        "calendar": [pd.Timestamp(d).date().isoformat() for d in calendar],
        "stocks": stocks_js, "prices": prices_js, "indices": indices_js,
        "signal_backtest": backtest.to_dict("records"), "ml": ml_report,
        "funds": funds_js, "nav": nav_js, "portfolios": portfolios,
        "holdings": holdings.drop(columns=["is_modelled"]).to_dict("records"),
        "options": chains,
        "flows": flows.assign(date=flows.date.dt.date.astype(str)).drop(columns=["is_modelled"]).to_dict("records"),
    }
    DOCS.mkdir(exist_ok=True)
    js = "window.DATA=" + json.dumps(clean(data), separators=(",", ":"), allow_nan=False) + ";"
    (DOCS / "data.js").write_text(js, encoding="utf-8")
    print(f"docs/data.js {len(js) / 1e6:.2f} MB; as of {data['meta']['as_of']}")
    print("ML:", ml_report)
    print(backtest.to_string(index=False))
    print(fm[["fund", "category", "r1y", "cagr3y", "sharpe", "score", "recommendation", "risk"]].round(3).to_string())


if __name__ == "__main__":
    main()
