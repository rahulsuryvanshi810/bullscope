"""Generate the Power BI project (PBIP: TMDL semantic model + report), the Power Query file and the
Tableau workbook (.twb) from data/processed/, powerbi/measures.dax and tableau/calculated_fields.md.

    python scripts/build_bi_files.py

Outputs
    powerbi/power_query.m                                  -> paste-in queries for building by hand
    powerbi/BullScope/BullScope.pbip     -> open in Power BI Desktop
    tableau/stocks_flat.csv, tableau/BullScope.twb -> open in Tableau Desktop / Public
"""
import json
import random
import re
import shutil
import uuid
from pathlib import Path
from xml.sax.saxutils import quoteattr

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PBI = ROOT / "powerbi"
TAB = ROOT / "tableau"
PROC = ROOT / "data" / "processed"
NAME = "BullScope"
RNG = random.Random(42)  # fixed seed: rebuilding gives the same lineage tags, so git diffs stay small


def q(name):
    """TMDL object name, always quoted."""
    return "'" + name.replace("'", "''") + "'"


def tag():
    return str(uuid.UUID(int=RNG.getrandbits(128), version=4))


def indent(text, n):
    return "\n".join(("\t" * n + line) if line.strip() else "" for line in text.strip("\n").splitlines())


# --------------------------------------------------------------------------- tables
S, D, F, I = "string", "dateTime", "double", "int64"
TABLES = {
    "Stock Prices": ("fact_stock_prices.csv", [
        ("date", D), ("symbol", S), ("open", F), ("high", F), ("low", F), ("close", F), ("volume", F),
        ("daily_return", F), ("turnover_cr", F), ("buy_value_cr", F), ("sell_value_cr", F)]),
    "Stocks": ("dim_stock.csv", [
        ("sym", S), ("name", S), ("sector", S), ("mcap_cr", F), ("pe", F), ("pb", F), ("eps", F), ("div_yield", F),
        ("beta", F), ("high_52w", F), ("low_52w", F), ("promoter_pct", F), ("institutions_pct", F), ("public_pct", F),
        ("bse_close", F), ("rsi", F), ("score", I), ("signal", S), ("p_up_20d", F), ("mc_exp_return_60d", F),
        ("mc_prob_up_60d", F)]),
    "Index Prices": ("fact_index_prices.csv", [
        ("date", D), ("symbol", S), ("open", F), ("high", F), ("low", F), ("close", F)]),
    "Funds": ("dim_fund.csv", [
        ("scheme_code", I), ("fund", S), ("fund_house", S), ("category", S), ("asset_class", S), ("aum_cr_approx", F),
        ("nav", F), ("r1m", F), ("r3m", F), ("r6m", F), ("r1y", F), ("cagr3y", F), ("cagr5y", F), ("volatility", F),
        ("sharpe", F), ("sortino", F), ("max_drawdown", F), ("beta", F), ("roll1y_pct_positive", F), ("sip_xirr", F),
        ("score", F), ("stars", I), ("recommendation", S), ("risk", S)]),
    "Fund NAV": ("fact_fund_nav.csv", [("date", D), ("nav", F), ("scheme_code", I)]),
    "Fund Holdings": ("fact_fund_holdings.csv", [
        ("scheme_code", I), ("symbol", S), ("company", S), ("sector", S), ("cap_bucket", S), ("weight_pct", F),
        ("value_cr", F), ("prev_value_cr", F), ("change_cr", F), ("change", S), ("stake_pct", F)]),
    "Option Chain": ("fact_option_chain.csv", [
        ("underlying", S), ("expiry", D), ("strike", F), ("type", S), ("ltp", F), ("iv", F), ("oi", F), ("chg_oi", F),
        ("volume", F), ("delta", F), ("gamma", F), ("theta", F), ("vega", F), ("spot", F), ("lot_size", I)]),
    "FII DII": ("fact_fii_dii.csv", [
        ("date", D), ("fii_buy", F), ("fii_sell", F), ("fii_net", F), ("dii_buy", F), ("dii_sell", F), ("dii_net", F),
        ("nifty_close", F)]),
}
MTYPE = {S: "type text", D: "type date", F: "type number", I: "Int64.Type"}
FORMATS = {"date": "d mmm yyyy", "expiry": "d mmm yyyy"}
PCT_COLS = {"daily_return", "promoter_pct", "institutions_pct", "public_pct", "p_up_20d", "mc_exp_return_60d",
            "mc_prob_up_60d", "r1m", "r3m", "r6m", "r1y", "cagr3y", "cagr5y", "volatility", "max_drawdown",
            "roll1y_pct_positive", "sip_xirr"}
HIDDEN = {"scheme_code"}
# summing these columns is meaningless; keep them as plain attributes
NO_SUM = {"open", "high", "low", "close", "pe", "pb", "eps", "div_yield", "beta", "high_52w", "low_52w", "rsi", "nav",
          "strike", "spot", "ltp", "iv", "delta", "gamma", "theta", "vega", "sharpe", "sortino", "score", "nifty_close",
          "bse_close"} | PCT_COLS

RELS = [("Stock Prices", "date", "Date", "Date"), ("Stock Prices", "symbol", "Stocks", "sym"),
        ("Index Prices", "date", "Date", "Date"), ("Fund NAV", "date", "Date", "Date"),
        ("Fund NAV", "scheme_code", "Funds", "scheme_code"), ("Fund Holdings", "scheme_code", "Funds", "scheme_code"),
        ("Fund Holdings", "symbol", "Stocks", "sym"), ("FII DII", "date", "Date", "Date")]

DATE_DAX = '''ADDCOLUMNS (
	CALENDAR ( DATE ( 2019, 1, 1 ), DATE ( 2027, 12, 31 ) ),
	"Year", YEAR ( [Date] ),
	"Quarter", "Q" & QUARTER ( [Date] ),
	"Month No", MONTH ( [Date] ),
	"Month", FORMAT ( [Date], "MMM yyyy" ),
	"Month Start", DATE ( YEAR ( [Date] ), MONTH ( [Date] ), 1 ),
	"Week Start", [Date] - WEEKDAY ( [Date], 2 ) + 1,
	"Weekday", FORMAT ( [Date], "ddd" ),
	"Weekday No", WEEKDAY ( [Date], 2 ),
	"Fiscal Year", "FY" & FORMAT ( IF ( MONTH ( [Date] ) >= 4, YEAR ( [Date] ) + 1, YEAR ( [Date] ) ) - 2000, "00" )
)'''
DATE_COLS = [("Date", D, "d mmm yyyy"), ("Year", I, "0"), ("Quarter", S, None), ("Month No", I, "0"),
             ("Month", S, None), ("Month Start", D, "mmm yyyy"), ("Week Start", D, "d mmm yyyy"),
             ("Weekday", S, None), ("Weekday No", I, "0"), ("Fiscal Year", S, None)]


def m_query(file, cols):
    names = ", ".join(f'"{c}"' for c, _ in cols)
    nontext = ", ".join(f'"{c}"' for c, t in cols if t != S)
    types = ",\n        ".join(f'{{"{c}", {MTYPE[t]}}}' for c, t in cols)
    return f'''let
    Source  = Csv.Document(File.Contents(DataFolder & "{file}"),
                [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Keep    = Table.SelectColumns(Headers, {{{names}}}),
    Blanks  = Table.ReplaceValue(Keep, "", null, Replacer.ReplaceValue, {{{nontext}}}),
    Typed   = Table.TransformColumnTypes(Blanks, {{
        {types}}}, "en-US")
in
    Typed'''


def write_power_query():
    head = """// =====================================================================
// BullScope - Power Query (M)
// 1. Home -> Transform data -> Manage parameters -> New: DataFolder (Text),
//    value = full path of this repo's data\\processed folder, ending with "\\"
// 2. For each query below: New Source -> Blank query -> Advanced Editor,
//    paste the block, rename the query to the name in the header.
// Generated by scripts/build_bi_files.py
// =====================================================================
"""
    body = [head] + [f"\n// ---------------- {t} ----------------\n{m_query(f, c)}\n" for t, (f, c) in TABLES.items()]
    (PBI / "power_query.m").write_text("".join(body), encoding="utf-8")


# --------------------------------------------------------------------------- measures from measures.dax
def parse_measures():
    src = (PBI / "measures.dax").read_text(encoding="utf-8")
    out, folder, cur = [], None, None
    for line in src.splitlines():
        m = re.match(r"// Folder: (.+)", line)
        if m:
            folder = m.group(1).strip()
            continue
        if folder is None or line.startswith("//"):
            continue
        m = re.match(r"^([A-Za-z][^=]*?)\s*=\s*(.*)$", line)
        if m and not line.startswith((" ", "\t", "VAR ", "RETURN")):
            cur = {"name": m.group(1).strip(), "expr": [m.group(2)], "folder": folder}
            out.append(cur)
        elif cur is not None:
            cur["expr"].append(line)
    for m in out:
        lines = [l.rstrip() for l in m["expr"]]
        while lines and not lines[-1].strip():
            lines.pop()
        while lines and not lines[0].strip():
            lines.pop(0)
        m["expr"] = "\n".join(lines)
    return out


def fmt(name):
    n = name.lower()
    if name in ("PCR Mood", "Top Fund by Score"):
        return None
    if "%" in name:
        return "0.0%"
    if "(cr)" in n:
        return "₹#,0"
    if n in ("pcr", "avg sharpe"):
        return "0.00"
    if any(w in n for w in ("close", "high", "low", "nav", "spot", "premium", "max pain", "spread", "index", "nifty", "sensex", "vix", "growth")):
        return "#,0.00"
    if "score" in n and "signal" not in n:
        return "0.0"
    return "#,0"


def column(name, dtype, fmt_=None, hidden=False, source=None, expr=None, sort_by=None, key=False, summarize=None):
    head = f"\tcolumn {q(name)}" + (" =\n" + indent(expr, 3) if expr else "")
    props = [f"dataType: {dtype}"]
    if fmt_:
        props.append(f"formatString: {fmt_}")
    if hidden:
        props.append("isHidden")
    if key:
        props.append("isKey")
    props.append(f"lineageTag: {tag()}")
    props.append("summarizeBy: " + (summarize or ("sum" if dtype in ("double", "decimal") else "none")))
    if source:
        props.append(f"sourceColumn: {source}")
    if sort_by:
        props.append(f"sortByColumn: {q(sort_by)}")
    return head + "\n" + "\n".join("\t\t" + p for p in props) + "\n"


def build_pbip():
    out = PBI / NAME
    if out.exists():
        shutil.rmtree(out)
    sm, rp = out / f"{NAME}.SemanticModel", out / f"{NAME}.Report"
    (sm / "definition" / "tables").mkdir(parents=True)
    rp.mkdir(parents=True)
    (out / f"{NAME}.pbip").write_text(json.dumps({
        "version": "1.0", "artifacts": [{"report": {"path": f"{NAME}.Report"}}],
        "settings": {"enableAutoRecovery": True}}, indent=2), encoding="utf-8")
    (sm / "definition.pbism").write_text(json.dumps({"version": "4.0", "settings": {}}, indent=2), encoding="utf-8")
    (rp / "definition.pbir").write_text(json.dumps({
        "version": "4.0", "datasetReference": {"byPath": {"path": f"../{NAME}.SemanticModel"}}}, indent=2),
        encoding="utf-8")

    d = sm / "definition"
    (d / "database.tmdl").write_text("database\n\tcompatibilityLevel: 1567\n\n", encoding="utf-8")
    tables = ["_Measures", *TABLES, "Date", "Top N"]
    model = ["model Model", "\tculture: en-US", "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
             "\tsourceQueryCulture: en-US", "\tdataAccessOptions", "\t\tlegacyRedirects", "\t\treturnErrorValuesAsNull",
             ""] + [f"ref table {q(t)}" for t in tables] + ["", "ref expression DataFolder", ""]
    (d / "model.tmdl").write_text("\n".join(model) + "\n", encoding="utf-8")
    data_dir = str(PROC) + "\\"
    (d / "expressions.tmdl").write_text(
        f'expression DataFolder = "{data_dir}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]\n'
        f"\tlineageTag: {tag()}\n\n", encoding="utf-8")
    rels = [f"relationship {tag()}\n\tfromColumn: {q(ft)}.{q(fc)}\n\ttoColumn: {q(tt)}.{q(tc)}\n" for ft, fc, tt, tc in RELS]
    (d / "relationships.tmdl").write_text("\n".join(rels), encoding="utf-8")

    for t, (file, cols) in TABLES.items():
        body = [f"table {q(t)}", f"\tlineageTag: {tag()}", ""]
        for c, dt in cols:
            f = FORMATS.get(c) or ("0.00%" if c in PCT_COLS else ("#,0.00" if dt == F else ("0" if dt == I else None)))
            body.append(column(c, dt, f, hidden=c in HIDDEN and t != "Funds", source=c,
                               key=(t, c) in {("Stocks", "sym"), ("Funds", "scheme_code")},
                               summarize="none" if c in NO_SUM else None))
        body.append(f"\tpartition {q(t)} = m\n\t\tmode: import\n\t\tsource =\n{indent(m_query(file, cols), 4)}\n")
        body.append("\tannotation PBI_ResultType = Table\n")
        (d / "tables" / f"{t}.tmdl").write_text("\n".join(body) + "\n", encoding="utf-8")

    body = ["table Date", "\tdataCategory: Time", f"\tlineageTag: {tag()}", ""]
    for c, dt, f in DATE_COLS:
        sort = {"Month": "Month Start", "Weekday": "Weekday No"}.get(c)
        body.append(column(c, dt, f, source=f"[{c}]", sort_by=sort, key=(c == "Date"), summarize="none"))
    body.append(f"\tpartition Date = calculated\n\t\tmode: import\n\t\tsource =\n{indent(DATE_DAX, 4)}\n")
    (d / "tables" / "Date.tmdl").write_text("\n".join(body) + "\n", encoding="utf-8")

    body = ["table 'Top N'", f"\tlineageTag: {tag()}", "", column("Top N", I, "0", source="[Value]", summarize="none"),
            "\tpartition 'Top N' = calculated\n\t\tmode: import\n\t\tsource = GENERATESERIES ( 5, 25, 1 )\n"]
    (d / "tables" / "Top N.tmdl").write_text("\n".join(body) + "\n", encoding="utf-8")

    measures = parse_measures()
    body = ["table _Measures", f"\tlineageTag: {tag()}", ""]
    for m in measures:
        expr = m["expr"]
        head = f"\tmeasure {q(m['name'])} = " + (expr.strip() if "\n" not in expr else "\n" + indent(expr, 3))
        props = [f"lineageTag: {tag()}"]
        f = fmt(m["name"])
        if f:
            props.append(f"formatString: {f}")
        props.append(f"displayFolder: {m['folder']}")
        body.append(head + "\n" + "\n".join("\t\t" + p for p in props) + "\n")
    body.append(column("Value", I, hidden=True, source="[Value]"))
    body.append("\tpartition _Measures = calculated\n\t\tmode: import\n\t\tsource = { 0 }\n")
    (d / "tables" / "_Measures.tmdl").write_text("\n".join(body) + "\n", encoding="utf-8")

    build_report(rp)
    return len(measures)


# --------------------------------------------------------------------------- report (legacy report.json)
def _field(kind, entity, prop, alias):
    return {kind: {"Expression": {"SourceRef": {"Source": alias}}, "Property": prop}, "Name": f"{entity}.{prop}"}


def visual(vid, vtype, x, y, w, h, roles, title=None):
    """roles: {role: [(kind 'Measure'|'Column', entity, property)]}"""
    aliases, frm, select, proj = {}, [], [], {}
    for role, fields in roles.items():
        proj[role] = []
        for kind, ent, prop in fields:
            if ent not in aliases:
                aliases[ent] = f"t{len(aliases)}"
                frm.append({"Name": aliases[ent], "Entity": ent, "Type": 0})
            sel = _field(kind, ent, prop, aliases[ent])
            if sel["Name"] not in [s["Name"] for s in select]:
                select.append(sel)
            proj[role].append({"queryRef": f"{ent}.{prop}"})
    sv = {"visualType": vtype, "projections": proj,
          "prototypeQuery": {"Version": 2, "From": frm, "Select": select}, "drillFilterOtherVisuals": True}
    if title:
        sv["vcObjects"] = {"title": [{"properties": {
            "show": {"expr": {"Literal": {"Value": "true"}}},
            "text": {"expr": {"Literal": {"Value": "'" + title.replace("'", "''") + "'"}}}}}]}
    cfg = {"name": vid, "layouts": [{"id": 0, "position": {"x": x, "y": y, "z": 0, "width": w, "height": h}}],
           "singleVisual": sv}
    return {"x": x, "y": y, "z": 0, "width": w, "height": h, "config": json.dumps(cfg), "filters": "[]"}


M = lambda p: ("Measure", "_Measures", p)
C = lambda e, p: ("Column", e, p)


def page(name, display, visuals, ordinal):
    return {"name": name, "displayName": display, "displayOption": 1, "width": 1280, "height": 720,
            "ordinal": ordinal, "config": "{}", "filters": "[]", "visualContainers": visuals}


def build_report(rp):
    date_slicer = lambda p: visual(f"{p}date", "slicer", 20, 16, 360, 60, {"Values": [C("Date", "Date")]}, "Period")
    p1 = [date_slicer("a"),
          visual("asec", "slicer", 400, 16, 300, 60, {"Values": [C("Stocks", "sector")]}, "Sector")] + [
        visual(f"ac{i}", "card", 20 + i * 207, 92, 197, 100, {"Values": [M(m)]}, t) for i, (m, t) in enumerate([
            ("NIFTY 50 Last", "NIFTY 50"), ("NIFTY 50 Return %", "NIFTY 50 return"), ("SENSEX Last", "SENSEX"),
            ("Advancers", "Stocks up"), ("Decliners", "Stocks down"), ("India VIX Last", "India VIX")])] + [
        visual("aline", "lineChart", 20, 208, 760, 290, {"Category": [C("Date", "Date")], "Y": [M("NIFTY 50 Close")]},
               "NIFTY 50"),
        visual("asect", "clusteredBarChart", 796, 208, 464, 290,
               {"Category": [C("Stocks", "sector")], "Y": [M("Avg Stock Return %")]}, "Average return by sector"),
        visual("atree", "treemap", 20, 514, 760, 190,
               {"Group": [C("Stocks", "sym")], "Values": [M("Market Cap (Cr)")]}, "Market cap"),
        visual("atab", "tableEx", 796, 514, 464, 190,
               {"Values": [C("Stocks", "sym"), M("Last Close"), M("Period Return %"), M("Volatility %")]},
               "Stocks"),
    ]
    p2 = [date_slicer("b"),
          visual("btopn", "slicer", 400, 16, 300, 60, {"Values": [C("Top N", "Top N")]}, "Top N"),
          visual("bstock", "slicer", 720, 16, 300, 60, {"Values": [C("Stocks", "sym")]}, "Stock")] + [
        visual(f"bc{i}", "card", 20 + i * 312, 92, 302, 100, {"Values": [M(m)]}, t) for i, (m, t) in enumerate([
            ("Turnover (Cr)", "Turnover (₹ Cr)"), ("Net Flow (Cr)", "Net buying (₹ Cr)"),
            ("FII Net (Cr)", "FII net (₹ Cr, modelled)"), ("DII Net (Cr)", "DII net (₹ Cr, modelled)")])] + [
        visual("bbar", "clusteredBarChart", 20, 208, 620, 300,
               {"Category": [C("Stocks", "sym")], "Y": [M("Net Flow (Cr)")]}, "Net buying by stock (₹ Cr)"),
        visual("bmon", "clusteredColumnChart", 656, 208, 604, 300,
               {"Category": [C("Date", "Month Start")], "Y": [M("Buy Value (Cr)"), M("Sell Value Negative (Cr)")]},
               "Bought vs sold by month (₹ Cr)"),
        visual("bfii", "lineChart", 20, 524, 1240, 180,
               {"Category": [C("Date", "Date")], "Y": [M("Cumulative FII Net (Cr)"), M("Cumulative DII Net (Cr)")]},
               "Cumulative FII and DII net flow (modelled)"),
    ]
    p3 = [date_slicer("c"),
          visual("ccat", "slicer", 400, 16, 300, 60, {"Values": [C("Funds", "category")]}, "Category"),
          visual("cfund", "slicer", 720, 16, 300, 60, {"Values": [C("Funds", "fund")]}, "Fund")] + [
        visual(f"cc{i}", "card", 20 + i * 250, 92, 240, 100, {"Values": [M(m)]}, t) for i, (m, t) in enumerate([
            ("Fund Count", "Funds"), ("Avg 3Y CAGR %", "Average 3Y CAGR"), ("Avg Sharpe", "Average Sharpe"),
            ("Avg Max Drawdown %", "Average max drawdown"), ("Top Fund by Score", "Top-scored fund")])] + [
        visual("cnav", "lineChart", 20, 208, 760, 290,
               {"Category": [C("Date", "Date")], "Series": [C("Funds", "fund")], "Y": [M("NAV")]}, "NAV history"),
        visual("cscat", "scatterChart", 796, 208, 464, 290,
               {"Category": [C("Funds", "fund")], "X": [C("Funds", "volatility")], "Y": [C("Funds", "cagr3y")]},
               "Risk vs 3Y return"),
        visual("ctab", "tableEx", 20, 514, 1240, 190,
               {"Values": [C("Funds", "fund"), C("Funds", "category"), C("Funds", "r1y"), C("Funds", "cagr3y"),
                           C("Funds", "cagr5y"), C("Funds", "sharpe"), C("Funds", "max_drawdown"), C("Funds", "score"),
                           C("Funds", "recommendation")]}, "Fund screener"),
    ]
    p4 = [visual("dfund", "slicer", 20, 16, 300, 60, {"Values": [C("Funds", "fund")]}, "Fund"),
          visual("dund", "slicer", 660, 16, 300, 60, {"Values": [C("Option Chain", "underlying")]}, "Underlying"),
          visual("dexp", "slicer", 980, 16, 280, 60, {"Values": [C("Option Chain", "expiry")]}, "Expiry")] + [
        visual("dhold", "tableEx", 20, 92, 620, 400,
               {"Values": [C("Fund Holdings", "company"), M("Holding Value (Cr)"), M("Total Fund Stake %"),
                           M("Funds Holding"), M("Holding Change (Cr)")]}, "Fund holdings (modelled)"),
        visual("dsec", "clusteredBarChart", 20, 508, 620, 196,
               {"Category": [C("Fund Holdings", "sector")], "Y": [M("Holding Value (Cr)")]}, "Holdings by sector (₹ Cr)"),
    ] + [visual(f"dk{i}", "card", 656 + i * 154, 92, 146, 100, {"Values": [M(m)]}, t) for i, (m, t) in enumerate([
        ("Spot", "Spot"), ("PCR", "Put-call ratio"), ("Max Pain", "Max pain"), ("ATM IV %", "ATM IV")])] + [
        visual("doi", "clusteredColumnChart", 656, 208, 604, 296,
               {"Category": [C("Option Chain", "strike")], "Y": [M("Call OI"), M("Put OI")]}, "Open interest by strike"),
        visual("dchg", "clusteredColumnChart", 656, 520, 604, 184,
               {"Category": [C("Option Chain", "strike")], "Y": [M("Call Change in OI"), M("Put Change in OI")]},
               "Change in OI"),
    ]
    report = {
        "config": json.dumps({"version": "5.43", "themeCollection": {}, "activeSectionIndex": 0,
                              "defaultDrillFilterOtherVisuals": True, "settings": {"useStylableVisualContainerHeader": True}}),
        "layoutOptimization": 0, "resourcePackages": [],
        "sections": [page("ReportSection1", "1 Market overview", p1, 0), page("ReportSection2", "2 Buy sell flow", p2, 1),
                     page("ReportSection3", "3 Mutual funds", p3, 2), page("ReportSection4", "4 Holdings & options", p4, 3)],
    }
    (rp / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------- Tableau workbook
TCOLS = [("date", "date"), ("symbol", "string"), ("open", "real"), ("high", "real"), ("low", "real"), ("close", "real"),
         ("volume", "real"), ("daily_return", "real"), ("turnover_cr", "real"), ("buy_value_cr", "real"),
         ("sell_value_cr", "real"), ("name", "string"), ("sector", "string"), ("mcap_cr", "real"), ("pe", "real"),
         ("signal", "string"), ("score", "integer")]


def write_flat_csv():
    px = pd.read_csv(PROC / "fact_stock_prices.csv")
    st = pd.read_csv(PROC / "dim_stock.csv")[["sym", "name", "sector", "mcap_cr", "pe", "signal", "score"]]
    flat = px.merge(st, left_on="symbol", right_on="sym").drop(columns="sym")
    flat[[c for c, _ in TCOLS]].to_csv(TAB / "stocks_flat.csv", index=False)
    return len(flat)


def parse_tableau_calcs():
    src = (TAB / "calculated_fields.md").read_text(encoding="utf-8")
    return [(n, f.strip()) for n, f in re.findall(r"\*\*(.+?)\*\*[^\n]*\n```\n(.*?)\n```", src, re.S)]


def build_twb():
    calcs = parse_tableau_calcs()
    params = {"p.Top N": ("integer", "10", ("range", 5, 25, 1)),
              "p.MA Window": ("integer", "50", ("range", 5, 200, 5)),
              "p.Metric": ("string", '"Turnover (Cr)"', ("list", ["Turnover (Cr)", "Net flow (Cr)", "Volume"]))}
    x = ["<?xml version='1.0' encoding='utf-8' ?>",
         "<workbook source-build='2024.2.0 (20242.24.0807.0327)' source-platform='win' version='18.1' "
         "xmlns:user='http://www.tableausoftware.com/xml/user'>",
         "  <preferences />", "  <datasources>",
         "    <datasource hasconnection='false' inline='true' name='Parameters' version='18.1'>",
         "      <aliases enabled='yes' />"]
    for n, (dt, val, dom) in params.items():
        if dom[0] == "range":
            x.append(f"      <column caption={quoteattr(n)} datatype='{dt}' name={quoteattr('[' + n + ']')} "
                     f"param-domain-type='range' role='measure' type='quantitative' value='{val}'>")
            x.append(f"        <calculation class='tableau' formula='{val}' />")
            x.append(f"        <range granularity='{dom[3]}' max='{dom[2]}' min='{dom[1]}' />")
        else:
            x.append(f"      <column caption={quoteattr(n)} datatype='string' name={quoteattr('[' + n + ']')} "
                     f"param-domain-type='list' role='measure' type='nominal' value={quoteattr(val)}>")
            x.append(f"        <calculation class='tableau' formula={quoteattr(val)} />")
            x.append("        <members>")
            for mbr in dom[1]:
                x.append(f"          <member value={quoteattr(chr(34) + mbr + chr(34))} />")
            x.append("        </members>")
        x.append("      </column>")
    x.append("    </datasource>")
    x += ["    <datasource caption='NIFTY 50 Daily' inline='true' name='federated.dsp0001' version='18.1'>",
          "      <connection class='federated'>", "        <named-connections>",
          "          <named-connection caption='stocks_flat' name='textscan.dsp0001'>",
          f"            <connection class='textscan' directory={quoteattr(str(TAB).replace(chr(92), '/'))} "
          "filename='stocks_flat.csv' password='' server='' />",
          "          </named-connection>", "        </named-connections>",
          "        <relation connection='textscan.dsp0001' name='stocks_flat.csv' "
          "table='[stocks_flat#csv]' type='table'>",
          "          <columns character-set='UTF-8' header='yes' locale='en_US' separator=','>"]
    for i, (c, dt) in enumerate(TCOLS):
        x.append(f"            <column datatype='{dt}' name='{c}' ordinal='{i}' />")
    x += ["          </columns>", "        </relation>", "      </connection>", "      <aliases enabled='yes' />"]
    for n, f in calcs:
        f = re.sub(r"\[(p\.[^\]]+)\]", r"[Parameters].[\1]", f)
        if n in ("Up Day", "Show Top N"):
            dt, role, typ = "boolean", "dimension", "nominal"
        elif n == "Net Flow Rank":
            dt, role, typ = "integer", "measure", "quantitative"
        else:
            dt, role, typ = "real", "measure", "quantitative"
        x.append(f"      <column caption={quoteattr(n)} datatype='{dt}' name={quoteattr('[' + n + ']')} "
                 f"role='{role}' type='{typ}'>")
        x.append(f"        <calculation class='tableau' formula={quoteattr(f)} />")
        x.append("      </column>")
    x += ["    </datasource>", "  </datasources>", "  <worksheets>"]
    x += ["    <worksheet name='Start here - drag fields from the Data pane'>", "      <table>", "        <view>",
          "          <datasources />", "          <aggregation value='true' />", "        </view>",
          "        <style />", "        <panes>", "          <pane selection-relaxation-option='selection-relaxation-allow'>",
          "            <view>", "              <breakdown value='auto' />", "            </view>",
          "            <mark class='Automatic' />", "          </pane>", "        </panes>",
          "        <rows />", "        <cols />", "      </table>",
          f"      <simple-id uuid='{{{tag().upper()}}}' />", "    </worksheet>"]
    x += ["  </worksheets>", "</workbook>", ""]
    (TAB / f"{NAME}.twb").write_text("\n".join(x), encoding="utf-8")
    return len(calcs)


if __name__ == "__main__":
    import sys
    if "--data-only" in sys.argv:  # CI: refresh the Tableau CSV without rewriting local paths in the BI files
        print(f"Tableau:  stocks_flat.csv {write_flat_csv():,} rows")
        sys.exit()
    write_power_query()
    n = build_pbip()
    print(f"Power BI: powerbi/{NAME}/{NAME}.pbip ({n} measures, {len(TABLES) + 2} tables, 4 pages)")
    rows = write_flat_csv()
    k = build_twb()
    print(f"Tableau:  tableau/{NAME}.twb ({k} calculated fields, 3 parameters), stocks_flat.csv {rows:,} rows")
