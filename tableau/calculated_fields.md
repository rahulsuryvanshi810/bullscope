# Tableau calculated fields

Field names match the columns of `stocks_flat.csv` (one row per stock per trading day, with the stock's name,
sector, market cap and signal joined on). Paste each formula into **Analysis → Create Calculated Field**.
Names in **bold** are the field names to use. The `.twb` built by `scripts/build_bi_files.py` already contains
all of them.

## Row-level fields

**Net Flow (Cr)**
```
[buy_value_cr] - [sell_value_cr]
```

**Up Day**
```
[daily_return] > 0
```

**Market Cap (Cr)**
```
{ FIXED [symbol] : MAX([mcap_cr]) }
```

## Aggregate fields

**Net Flow %**
```
SUM([Net Flow (Cr)]) / SUM([turnover_cr])
```

**Volatility %**
```
STDEV([daily_return]) * SQRT(252)
```

**Selected Metric**
```
CASE [p.Metric]
WHEN "Turnover (Cr)" THEN SUM([turnover_cr])
WHEN "Net flow (Cr)" THEN SUM([Net Flow (Cr)])
ELSE SUM([volume])
END
```

## Table calculations (compute along `date`)

**Period Return %**
```
LOOKUP(SUM([close]), LAST()) / LOOKUP(SUM([close]), FIRST()) - 1
```

**Indexed Price**
```
SUM([close]) / LOOKUP(SUM([close]), FIRST()) * 100
```

**Moving Average**
```
WINDOW_AVG(SUM([close]), -[p.MA Window] + 1, 0)
```

**Net Flow Rank**
```
RANK(SUM([Net Flow (Cr)]))
```

**Show Top N**
```
RANK(SUM([Net Flow (Cr)])) <= [p.Top N]
```

## Parameters

| Parameter | Type | Values |
|---|---|---|
| `p.Top N` | integer | 5 – 25, default 10 |
| `p.MA Window` | integer | 5 – 200, default 50 |
| `p.Metric` | string | Turnover (Cr), Net flow (Cr), Volume |
