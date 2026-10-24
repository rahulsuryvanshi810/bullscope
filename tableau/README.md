# Tableau: BullScope

`BullScope.twb` connects to `stocks_flat.csv` (47,777 rows: one per stock per trading day, with the stock's
name, sector, market cap, P/E and signal joined on). It already contains the 11 calculated fields from
`calculated_fields.md` and 3 parameters (`p.Top N`, `p.MA Window`, `p.Metric`).

## Open it
1. Install **Tableau Public** (free) or Tableau Desktop.
2. Open `BullScope.twb`. If Tableau cannot find the CSV, choose *Edit connection* and point it at
   `tableau/stocks_flat.csv`.
3. To add funds, holdings or options, *Data → New Data Source → Text file* and pick the matching CSV in
   `data/processed/`.

## Suggested sheets and dashboard

| Sheet | Build |
|---|---|
| Price + MA | Columns `date` (exact day), Rows `SUM(close)` and `Moving Average` (dual marks on one axis), filter `symbol` (single value), show `p.MA Window` |
| Most bought / sold | Rows `symbol`, Columns `SUM(Net Flow (Cr))`, colour by sign, filter `Show Top N` = True, show `p.Top N` |
| Sector treemap | Marks: Square; Size `Market Cap (Cr)`; Colour `Period Return %` (diverging red–green, compute along date); Detail `sector`, `symbol` |
| Metric by month | Columns `MONTH(date)`, Rows `Selected Metric`, show `p.Metric` |
| Volatility vs return | Columns `Volatility %`, Rows `Period Return %`, Detail `symbol`, Colour `sector` |

Dashboard: put the date filter and `p.Top N` on top, use *Use as filter* on the treemap so a click filters the price
chart, then *File → Save to Tableau Public* and add the link to the main README.
