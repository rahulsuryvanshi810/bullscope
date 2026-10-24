"""Data-quality checks on the processed tables and the dashboard data file."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
PROC = ROOT / "data" / "processed"


@pytest.fixture(scope="module")
def prices():
    return pd.read_csv(PROC / "fact_stock_prices.csv", parse_dates=["date"])


@pytest.fixture(scope="module")
def web():
    s = (ROOT / "docs" / "data.js").read_text(encoding="utf-8")
    return json.loads(s[len("window.DATA="):-1])


def test_price_history_covers_three_years(prices):
    assert prices["symbol"].nunique() == 51
    assert (prices["date"].max() - prices["date"].min()).days > 3 * 365


def test_ohlc_is_consistent(prices):
    tol = 1e-6 * prices["close"]
    assert (prices["high"] + tol >= prices[["open", "close"]].max(axis=1)).all()
    assert (prices["low"] - tol <= prices[["open", "close"]].min(axis=1)).all()
    assert (prices["volume"] >= 0).all()


def test_buy_plus_sell_equals_turnover(prices):
    diff = (prices["buy_value_cr"] + prices["sell_value_cr"] - prices["turnover_cr"]).abs()
    assert (diff < 0.01).all()


def test_no_false_demerger_crash(prices):
    tm = prices[prices.symbol == "TMPV"].sort_values("date")
    assert tm["close"].pct_change().abs().max() < 0.25


def test_fund_metrics_are_sane():
    f = pd.read_csv(PROC / "dim_fund.csv")
    assert len(f) == 80
    assert f["score"].between(0, 100).all()
    assert (f["max_drawdown"] <= 0).all()
    assert f.loc[f.category == "Liquid", "volatility"].iloc[0] < 0.02


def test_holdings_weights_and_stakes():
    h = pd.read_csv(PROC / "fact_fund_holdings.csv")
    w = h.groupby("scheme_code")["weight_pct"].sum()
    assert np.allclose(w, 100, atol=0.2)
    assert (h["stake_pct"] <= 10).all()  # SEBI limit per scheme
    assert (h["is_modelled"] == 1).all()


def test_option_chain_put_call_parity():
    oc = pd.read_csv(PROC / "fact_option_chain.csv")
    wide = oc.pivot_table(index=["underlying", "expiry", "strike"], columns="type", values=["ltp", "spot"]).dropna()
    # C - P should sit close to S - K (small time value of money for short expiries)
    lhs = wide[("ltp", "CE")] - wide[("ltp", "PE")]
    rhs = wide[("spot", "CE")] - wide.index.get_level_values("strike")
    deep = (wide[("ltp", "CE")] > 0.06) & (wide[("ltp", "PE")] > 0.06)
    assert ((lhs - rhs)[deep].abs() / wide[("spot", "CE")][deep] < 0.03).all()


def test_web_data_matches_tables(web):
    assert len(web["stocks"]) == 51
    assert len(web["funds"]) == 80
    assert set(web["options"]) >= {"NIFTY", "BANKNIFTY"}
    for sym, p in web["prices"].items():
        assert len(p["c"]) == len(web["calendar"]) - p["s"], sym
