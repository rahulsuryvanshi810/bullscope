/* BullScope: dashboard logic. Data comes from data.js (window.DATA), built by scripts/build_dataset.py. */
"use strict";

const D = window.DATA;
const CAL = D.calendar;
const N = CAL.length;
const STK = Object.fromEntries(D.stocks.map(s => [s.sym, s]));
const FUND = Object.fromEntries(D.funds.map(f => [f.scheme_code, f]));
const $ = s => document.querySelector(s);
const el = id => document.getElementById(id);

// ---------------------------------------------------------------- storage (per-viewer conveniences only)
const store = {
  get(k, d) { try { const v = localStorage.getItem("dsp-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("dsp-" + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};

const state = Object.assign({
  page: "overview", range: "1Y", from: null, to: null,
  ovIdx: "NIFTY 50", stock: "RELIANCE", overlays: ["SMA 50", "SMA 200"],
  flStock: "RELIANCE", fno: "NIFTY", expiry: 0, chainCols: "Basic",
  mfCat: "All", fund: 122639, cmp: [], mfSort: ["score", -1],
  hMode: "By fund", hFund: 122639, hStock: "HDFCBANK",
  profile: null, screen: "All", extFunds: [], pf: [], watch: [], ov52: "Near high",
  newsCat: "All", newsTone: "All", newsTag: "", newsTab: "Headlines", newsView: "Magazine", newsSrc: "", saved: [], vidChan: "All", bg: "gold", watchlists: null, wlActive: 0, cryCur: "inr", cryCoin: "bitcoin", cryDays: 30,
  cmpItems: [{ key: "I:NIFTY 50", c: 0 }, { key: "S:RELIANCE", c: 1 }, { key: "S:HDFCBANK", c: 2 }, { key: "F:122639", c: 3 }],
}, store.get("state", {}));
state.legs = [];
const save = () => { const { legs, ...rest } = state; store.set("state", rest); };

// ---------------------------------------------------------------- formatting
const nf = (x, d = 2) => (x == null || isNaN(x)) ? "—" : Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 2) => (x == null || isNaN(x)) ? "—" : (x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
const pctu = (x, d = 1) => (x == null || isNaN(x)) ? "—" : (x * 100).toFixed(d) + "%";
const rupee = (x, d = 2) => (x == null || isNaN(x)) ? "—" : "₹" + nf(x, d);
const cr = x => {
  if (x == null || isNaN(x)) return "—";
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  if (a >= 1e5) return s + "₹" + nf(a / 1e5, 2) + " L Cr";
  return s + "₹" + nf(a, a >= 100 ? 0 : 1) + " Cr";
};
const inrShort = x => {
  const a = Math.abs(x), s = x < 0 ? "−₹" : "₹";
  if (a >= 1e7) return s + nf(a / 1e7, 2) + " Cr";
  if (a >= 1e5) return s + nf(a / 1e5, 2) + " L";
  return s + nf(a, 0);
};
const cls = x => x > 0 ? "up" : x < 0 ? "down" : "mut";
const arrow = x => x > 0 ? "▲" : x < 0 ? "▼" : "■";
const chg = (x, d = 2) => `<span class="${cls(x)}">${arrow(x)} ${pct(x, d)}</span>`;
const fmtDate = s => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const fmtShort = s => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sum = a => a.reduce((x, y) => x + y, 0);
const tile = (k, v, d = "", extra = "") => `<div class="tile ${extra}"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ""}</div>`;
const recBadge = r => `<span class="badge ${r === "Strong Buy" || r === "Buy" ? "b-up" : r === "Hold" ? "b-neu" : "b-down"}">${r}</span>`;
const sigBadge = s => `<span class="badge ${s.includes("Buy") ? "b-up" : s === "Hold" ? "b-neu" : "b-down"}">${s.includes("Buy") ? "▲" : s === "Hold" ? "■" : "▼"} ${s}</span>`;
const stars = n => "★".repeat(n) + `<span class="mut">${"★".repeat(5 - n)}</span>`;

// ---------------------------------------------------------------- theme + charts
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function T() {
  return {
    text: css("--text"), text2: css("--text-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
    surface: css("--surface"), border: css("--border"), up: css("--up"), down: css("--down"), accent: css("--accent"),
    neutral: css("--neutral"), s: [1, 2, 3, 4, 5, 6, 7, 8].map(i => css("--s" + i)),
  };
}
const charts = {};
function chart(id, opt) {
  const node = el(id);
  let c = charts[id];
  if (!c || c.getDom() !== node) { c = echarts.init(node); charts[id] = c; }
  c.setOption(opt, true);
  c.resize();
  return c;
}
window.addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));

function base(t, extra = {}) {
  return Object.assign({
    textStyle: { fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif", color: t.text2 },
    animationDuration: 300,
    grid: { left: 8, right: 18, top: 18, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis", backgroundColor: t.surface, borderColor: t.axis, borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 }, extraCssText: "box-shadow:0 6px 20px rgba(0,0,0,.14);border-radius:8px;",
      axisPointer: { type: "line", lineStyle: { color: t.axis } },
    },
  }, extra);
}
const xCat = (t, data, extra = {}) => Object.assign({ type: "category", data, boundaryGap: true, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } }, extra);
const yVal = (t, fmt, extra = {}) => Object.assign({ type: "value", scale: true, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, fontSize: 11, formatter: fmt } }, extra);
const hex = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a, b, w) => { const A = hex(a), B = hex(b); return "rgb(" + A.map((v, i) => Math.round(v + (B[i] - v) * w)).join(",") + ")"; };
const alpha = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
function divColor(t, x, lim) {
  const w = Math.max(-1, Math.min(1, x / lim));
  return w >= 0 ? mix(t.neutral, t.up, Math.pow(w, 0.8)) : mix(t.neutral, t.down, Math.pow(-w, 0.8));
}

// ---------------------------------------------------------------- data access
function rangeDates() {
  const last = CAL[N - 1];
  if (state.range === "CUSTOM" && state.from && state.to) return [state.from, state.to];
  const end = new Date(last + "T00:00:00");
  let d = new Date(end);
  switch (state.range) {
    case "1M": d.setMonth(d.getMonth() - 1); break;
    case "3M": d.setMonth(d.getMonth() - 3); break;
    case "6M": d.setMonth(d.getMonth() - 6); break;
    case "YTD": d = new Date(end.getFullYear(), 0, 1); break;
    case "2Y": d.setFullYear(d.getFullYear() - 2); break;
    case "3Y": d.setFullYear(d.getFullYear() - 3); break;
    case "MAX": return [CAL[0], last];
    default: d.setFullYear(d.getFullYear() - 1);
  }
  return [isoLocal(d), last];
}
function rangeIdx() {
  const [a, b] = rangeDates();
  let i0 = CAL.findIndex(x => x >= a);
  if (i0 < 0) i0 = 0;
  let i1 = N - 1;
  while (i1 > 0 && CAL[i1] > b) i1--;
  return [Math.min(i0, i1), i1];
}
const P = sym => D.prices[sym];
function at(sym, key, i) { const p = P(sym), j = i - p.s; return j >= 0 && j < p[key].length ? p[key][j] : null; }
function stockRet(sym, i0, i1) { const a = at(sym, "c", Math.max(i0, P(sym).s)), b = at(sym, "c", i1); return a && b ? b / a - 1 : null; }
function idxAt(name, i) { const s = D.indices[name]; while (i > 0 && s[i] == null) i--; return s[i]; }
function idxRet(name, i0, i1) { return idxAt(name, i1) / idxAt(name, i0) - 1; }
const lastClose = sym => at(sym, "c", N - 1);
const dayChg = sym => at(sym, "c", N - 1) / at(sym, "c", N - 2) - 1;

// money flow per stock per day, built once
const FLOW = {};
function flow(sym) {
  if (FLOW[sym]) return FLOW[sym];
  const p = P(sym), n = p.c.length, buy = new Float64Array(n), sell = new Float64Array(n), to = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const hl = p.h[j] - p.l[j], clv = hl > 0 ? ((p.c[j] - p.l[j]) - (p.h[j] - p.c[j])) / hl : 0;
    to[j] = p.c[j] * p.v[j] / 1e7;
    buy[j] = to[j] * (1 + clv) / 2;
    sell[j] = to[j] - buy[j];
  }
  return (FLOW[sym] = { buy, sell, to });
}
function flowSum(sym, i0, i1) {
  const f = flow(sym), s = P(sym).s;
  let b = 0, se = 0, t = 0;
  for (let i = Math.max(i0, s); i <= i1; i++) { const j = i - s; b += f.buy[j]; se += f.sell[j]; t += f.to[j]; }
  return { buy: b, sell: se, net: b - se, turnover: t };
}

// NAV helpers
const EPOCH = new Date("2019-01-01T00:00:00").getTime();
const NAVD = {};
function navSeries(code) {
  if (NAVD[code]) return NAVD[code];
  const s = D.nav[code];
  return (NAVD[code] = { d: s.d.map(x => isoLocal(new Date(EPOCH + x * 864e5))), n: s.n });
}

// ---------------------------------------------------------------- shell: router, range bar, theme
const PAGES = ["overview", "stocks", "compare", "flow", "news", "crypto", "fno", "funds", "holdings", "advisor", "portfolio", "about"];
const RANGED = new Set(["overview", "stocks", "compare", "flow", "funds", "portfolio"]);
const RENDER = {};
const PRESETS = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "3Y", "MAX"];

function seg(id, options, current, onPick) {
  const box = el(id);
  box.innerHTML = options.map(o => `<button type="button" class="${o === current ? "on" : ""}" data-v="${esc(o)}">${esc(o)}</button>`).join("");
  box.onclick = e => { const b = e.target.closest("button"); if (b) onPick(b.dataset.v); };
}
function chips(id, options, isOn, onPick, labels) {
  const box = el(id);
  box.innerHTML = options.map((o, i) => `<button type="button" class="chip ${isOn(o) ? "on" : ""}" data-v="${esc(o)}">${esc(labels ? labels[i] : o)}</button>`).join("");
  box.onclick = e => { const b = e.target.closest("button"); if (b) onPick(b.dataset.v); };
}

function renderRangeBar() {
  seg("rangeSeg", PRESETS, state.range, v => { state.range = v; save(); renderRangeBar(); render(); });
  const [a, b] = rangeDates();
  el("dFrom").value = a; el("dTo").value = b;
  el("dFrom").min = el("dTo").min = CAL[0]; el("dFrom").max = el("dTo").max = CAL[N - 1];
  const [i0, i1] = rangeIdx();
  el("rangeText").textContent = `${fmtDate(CAL[i0])} → ${fmtDate(CAL[i1])} · ${i1 - i0 + 1} sessions`;
}
function onCustomDate() {
  const a = el("dFrom").value, b = el("dTo").value;
  if (!a || !b || a > b) return;
  Object.assign(state, { range: "CUSTOM", from: a, to: b }); save(); renderRangeBar(); render();
}

function go(page) {
  if (!PAGES.includes(page)) page = "overview";
  state.page = page; save();
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + page));
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.page === page));
  el("rangeBar").classList.toggle("hidden", !RANGED.has(page));
  el("sidebar").classList.remove("open");
  render();
  window.scrollTo(0, 0);
}
function render() { RENDER[state.page](); }
function openStock(sym) { state.stock = sym; state.flStock = sym; save(); location.hash = "stocks"; }

function setupShell() {
  const last = CAL[N - 1];
  el("footAsOf").textContent = `Prices as of ${fmtDate(last)} close`;
  el("sideNote").innerHTML = `<b>Data as of ${fmtDate(last)}</b> (closing prices).<br>Refreshed every weekday evening by GitHub Actions.`;
  // IST market hours: Mon–Fri 09:15–15:30
  const now = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 6e4);
  const mins = now.getHours() * 60 + now.getMinutes(), wd = now.getDay();
  const open = wd >= 1 && wd <= 5 && mins >= 555 && mins <= 930;
  el("mktDot").classList.toggle("open", open);
  el("mktStatus").textContent = open ? `Market open · showing ${fmtShort(last)} close` : `Market closed · last close ${fmtShort(last)}`;
  const items = ["NIFTY 50", "SENSEX", "NIFTY BANK", "NIFTY IT", "NIFTY MIDCAP 50", "INDIA VIX"].map(n => {
    const v = idxAt(n, N - 1), c = v / idxAt(n, N - 2) - 1;
    return `<span class="tape-item">${n}<b>${nf(v)}</b>${chg(c)}</span>`;
  }).concat(D.stocks.slice(0, 20).map(s => `<span class="tape-item">${s.sym}<b>${nf(lastClose(s.sym))}</b>${chg(dayChg(s.sym))}</span>`)).join("");
  el("tape").innerHTML = items + items;

  el("themeBtn").onclick = () => {
    const dark = css("color-scheme") === "dark";
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("dsp-theme", dark ? "light" : "dark"); } catch (e) { /* storage blocked */ }
    render();
    if (typeof setBackground === "function") setBackground(state.bg);
  };
  el("menuBtn").onclick = () => el("sidebar").classList.toggle("open");
  el("dFrom").onchange = el("dTo").onchange = onCustomDate;
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
}

// ================================================================= OVERVIEW
RENDER.overview = function () {
  const t = T(), [i0, i1] = rangeIdx();
  const tiles = ["NIFTY 50", "SENSEX", "NIFTY BANK", "NIFTY IT", "NIFTY MIDCAP 50", "INDIA VIX"];
  el("ovTiles").innerHTML = tiles.map(n => {
    const v = idxAt(n, i1), d1 = v / idxAt(n, i1 - 1) - 1, pr = idxRet(n, i0, i1);
    return `<div class="tile click ${state.ovIdx === n ? "sel" : ""}" data-idx="${n}"><div class="k">${n}</div><div class="v">${nf(v)}</div><div class="d">${chg(d1)} day · ${chg(pr, 1)} period</div></div>`;
  }).join("");
  el("ovTiles").onclick = e => { const x = e.target.closest("[data-idx]"); if (x) { state.ovIdx = x.dataset.idx; save(); RENDER.overview(); } };
  const idxOpts = ["NIFTY 50", "SENSEX", "NIFTY BANK", "NIFTY MIDCAP 50", "NIFTY IT", "INDIA VIX"];
  seg("ovIdxSeg", idxOpts, state.ovIdx, v => { state.ovIdx = v; save(); RENDER.overview(); });
  el("ovIdxTitle").textContent = state.ovIdx;

  const dates = CAL.slice(i0, i1 + 1), vals = dates.map((_, k) => D.indices[state.ovIdx][i0 + k]);
  const first = vals.find(v => v != null), lastV = idxAt(state.ovIdx, i1);
  const col = state.ovIdx === "INDIA VIX" ? t.s[0] : (lastV >= first ? t.up : t.down);
  chart("ovIdxChart", base(t, {
    tooltip: { ...base(t).tooltip, formatter: p => `${fmtDate(p[0].axisValue)}<br><b>${nf(p[0].value)}</b> &nbsp;${chg(p[0].value / first - 1)} from start` },
    xAxis: xCat(t, dates, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } }),
    yAxis: yVal(t, v => nf(v, 0)),
    series: [{ type: "line", data: vals, showSymbol: false, lineStyle: { width: 2, color: col }, itemStyle: { color: col }, connectNulls: true,
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: alpha(col, 0.18) }, { offset: 1, color: alpha(col, 0) }]) } }],
  }));

  const sectors = ["NIFTY BANK", "NIFTY IT", "NIFTY PHARMA", "NIFTY AUTO", "NIFTY FMCG", "NIFTY METAL", "NIFTY ENERGY", "NIFTY MIDCAP 50"]
    .map(n => ({ n: n.replace("NIFTY ", ""), r: idxRet(n, i0, i1) })).sort((a, b) => a.r - b.r);
  chart("ovSector", base(t, {
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: <b>${pct(p[0].value / 100)}</b>` },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: yVal(t, v => v + "%", { scale: false }), yAxis: xCat(t, sectors.map(s => s.n)),
    series: [{ type: "bar", barWidth: "58%", data: sectors.map(s => ({ value: +(s.r * 100).toFixed(2), itemStyle: { color: s.r >= 0 ? t.up : t.down, borderRadius: s.r >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => pct(p.value / 100, 1) } }],
  }));

  // heatmap
  const rets = D.stocks.map(s => ({ s, r: stockRet(s.sym, i0, i1) }));
  const absr = rets.map(x => Math.abs(x.r)).sort((a, b) => a - b);
  const lim = Math.max(0.02, absr[Math.floor(absr.length * 0.9)]);
  const bySector = {};
  rets.forEach(({ s, r }) => { (bySector[s.sector] = bySector[s.sector] || []).push({ name: s.sym, value: s.mcap_cr, ret: r, full: s.name, itemStyle: { color: divColor(t, r, lim) } }); });
  chart("ovHeat", {
    tooltip: { backgroundColor: t.surface, borderColor: t.axis, textStyle: { color: t.text, fontSize: 12 },
      formatter: p => p.data.ret == null ? `<b>${p.name}</b>` : `<b>${p.data.full}</b> (${p.name})<br>Return: ${chg(p.data.ret)}<br>Market cap: ${cr(p.value)}` },
    series: [{
      type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, width: "100%", height: "100%",
      label: { show: true, formatter: p => `{a|${p.name}}\n{b|${pct(p.data.ret, 1)}}`, rich: { a: { fontSize: 12, fontWeight: 700, color: t.text }, b: { fontSize: 11, color: t.text } } },
      levels: [{ itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 3 } },
        { itemStyle: { borderColor: t.surface, borderWidth: 3, gapWidth: 2, color: t.surface }, upperLabel: { show: true, height: 20, color: t.text2, fontSize: 11, fontWeight: 600, formatter: "{b}" } },
        { itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 2, borderRadius: 3 } }],
      data: Object.entries(bySector).map(([k, v]) => ({ name: k, children: v, itemStyle: { color: t.surface } })),
    }],
  }).off("click");
  charts.ovHeat.on("click", p => { if (p.data && p.data.ret != null) openStock(p.name); });
  el("heatLegend").innerHTML = [-lim, -lim / 2, 0, lim / 2, lim].map(v => `<span><i style="background:${divColor(t, v, lim)}"></i>${pct(v, 0)}</span>`).join("");

  const sorted = rets.filter(x => x.r != null).sort((a, b) => b.r - a.r);
  const rowsRet = list => `<table><thead><tr><th>Stock</th><th class="num">Price</th><th class="num">Return</th></tr></thead><tbody>${list.map(({ s, r }) =>
    `<tr class="click" data-sym="${s.sym}"><td class="name-cell"><b>${s.sym}</b><span>${esc(s.name)}</span></td><td class="num">${nf(at(s.sym, "c", i1))}</td><td class="num">${chg(r)}</td></tr>`).join("")}</tbody></table>`;
  el("ovGainers").innerHTML = rowsRet(sorted.slice(0, 6));
  el("ovLosers").innerHTML = rowsRet(sorted.slice(-6).reverse());
  const act = D.stocks.map(s => ({ s, t: flowSum(s.sym, i0, i1).turnover })).sort((a, b) => b.t - a.t).slice(0, 6);
  el("ovActive").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Turnover</th><th class="num">Avg / day</th></tr></thead><tbody>${act.map(({ s, t: x }) =>
    `<tr class="click" data-sym="${s.sym}"><td class="name-cell"><b>${s.sym}</b><span>${esc(s.name)}</span></td><td class="num">${cr(x)}</td><td class="num">${cr(x / (i1 - i0 + 1))}</td></tr>`).join("")}</tbody></table>`;
};
document.addEventListener("click", e => { const r = e.target.closest("tr[data-sym]"); if (r) openStock(r.dataset.sym); });

// ================================================================= STOCKS
function sma(a, n) { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function stdev(a, n, m) { return a.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += (a[k] - m[i]) ** 2; return Math.sqrt(s / n); }); }
function rsiArr(c, n = 14) {
  const o = new Array(c.length).fill(null); let up = 0, dn = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { up += u / n; dn += w / n; } else { up = (up * (n - 1) + u) / n; dn = (dn * (n - 1) + w) / n; }
    if (i >= n) o[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return o;
}

RENDER.stocks = function () {
  const t = T(), [i0r, i1] = rangeIdx(), sym = state.stock, s = STK[sym], p = P(sym);
  const i0 = Math.max(i0r, p.s), j0 = i0 - p.s, j1 = i1 - p.s;
  el("stockList").innerHTML = D.stocks.map(x => `<option value="${x.sym}">${esc(x.name)}</option>`).join("");
  el("stockSearch").value = "";
  el("stockSearch").placeholder = `${sym} · search another stock`;
  el("stockSearch").onchange = e => {
    const q = e.target.value.trim().toUpperCase();
    const hit = STK[q] || D.stocks.find(x => x.name.toUpperCase().includes(q) || x.sym.includes(q));
    if (hit) { state.stock = hit.sym; save(); RENDER.stocks(); }
  };

  const last = p.c[j1], prev = p.c[j1 - 1], d1 = last / prev - 1, bse = s.bse_close;
  const lo52 = s.low_52w, hi52 = s.high_52w, pos52 = (last - lo52) / (hi52 - lo52);
  el("stHead").innerHTML = `
    <div><div style="font-size:20px;font-weight:700">${esc(s.name)}</div><div class="mut">${sym} · <span class="badge b-acc">${s.sector}</span></div></div>
    <div class="exch"><span>NSE</span><div class="px">${rupee(last)}</div><div>${chg(d1)} <span class="mut">(${d1 >= 0 ? "+" : "−"}${nf(Math.abs(last - prev))})</span></div></div>
    <div class="exch"><span>BSE</span><div style="font-size:22px;font-weight:650">${rupee(bse)}</div><div class="mut">NSE–BSE spread ${bse ? nf(last - bse) : "—"}</div></div>
    <div class="exch" style="min-width:220px"><span>52-WEEK RANGE</span><div class="meter" style="margin:8px 0 4px"><i style="left:0;width:${Math.max(2, Math.min(100, pos52 * 100))}%;background:${t.s[0]}"></i></div>
      <div class="mut" style="display:flex;justify-content:space-between;font-size:12px"><span>${nf(lo52)}</span><span>${nf(hi52)}</span></div></div>
    <div class="exch"><span>AS OF</span><div>${fmtDate(CAL[i1])} close</div></div>`;

  const c = p.c.slice(j0, j1 + 1), h = p.h.slice(j0, j1 + 1), l = p.l.slice(j0, j1 + 1);
  const r = [];
  for (let k = 1; k < c.length; k++) r.push(Math.log(c[k] / c[k - 1]));
  const vol = Math.sqrt(sum(r.map(x => x * x)) / Math.max(1, r.length) - (sum(r) / Math.max(1, r.length)) ** 2) * Math.sqrt(252);
  let peak = c[0], mdd = 0; c.forEach(x => { peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); });
  const fs = flowSum(sym, i0, i1);
  el("stTiles").innerHTML = [
    tile("Period return", chg(last / c[0] - 1), `from ${rupee(c[0])}`),
    tile("Period high", rupee(Math.max(...h)), ""), tile("Period low", rupee(Math.min(...l)), ""),
    tile("Avg daily turnover", cr(fs.turnover / c.length), `net flow ${cr(fs.net)}`),
    tile("Volatility (ann.)", pctu(vol), "from daily returns"),
    tile("Max drawdown", `<span class="down">${pct(mdd, 1)}</span>`, "peak to trough"),
    tile("Signal", sigBadge(s.signal), `score ${s.score > 0 ? "+" : ""}${s.score} / 5`),
  ].join("");

  // candles
  const OV = ["SMA 20", "SMA 50", "SMA 200", "Bollinger"];
  chips("stOverlays", OV, o => state.overlays.includes(o), v => {
    state.overlays = state.overlays.includes(v) ? state.overlays.filter(x => x !== v) : [...state.overlays, v]; save(); RENDER.stocks();
  });
  const dates = CAL.slice(i0, i1 + 1);
  const ohlc = dates.map((_, k) => [p.o[j0 + k], p.c[j0 + k], p.l[j0 + k], p.h[j0 + k]]);
  const vols = dates.map((_, k) => ({ value: p.v[j0 + k], itemStyle: { color: alpha(p.c[j0 + k] >= p.o[j0 + k] ? t.up : t.down, 0.5) } }));
  const rs = rsiArr(p.c).slice(j0, j1 + 1);
  const ovSeries = [];
  const ovColors = { "SMA 20": t.s[0], "SMA 50": t.s[6], "SMA 200": t.s[3] };
  [["SMA 20", 20], ["SMA 50", 50], ["SMA 200", 200]].forEach(([name, n]) => {
    if (state.overlays.includes(name)) ovSeries.push({ name, type: "line", data: sma(p.c, n).slice(j0, j1 + 1), showSymbol: false, lineStyle: { width: 1.6, color: ovColors[name] }, itemStyle: { color: ovColors[name] }, xAxisIndex: 0, yAxisIndex: 0 });
  });
  if (state.overlays.includes("Bollinger")) {
    const m = sma(p.c, 20), sd = stdev(p.c, 20, m);
    const up = m.map((x, i) => x == null ? null : x + 2 * sd[i]).slice(j0, j1 + 1), dn = m.map((x, i) => x == null ? null : x - 2 * sd[i]).slice(j0, j1 + 1);
    ovSeries.push({ name: "Bollinger upper", type: "line", data: up, showSymbol: false, lineStyle: { width: 1, color: t.muted } },
      { name: "Bollinger lower", type: "line", data: dn, showSymbol: false, lineStyle: { width: 1, color: t.muted } });
  }
  chart("stCandle", base(t, {
    animation: false,
    legend: { top: 0, left: 0, textStyle: { color: t.text2, fontSize: 12 }, icon: "roundRect", itemWidth: 12, itemHeight: 4, data: ["Price", ...ovSeries.map(x => x.name)] },
    tooltip: { ...base(t).tooltip, axisPointer: { type: "cross", label: { backgroundColor: t.text2 } },
      formatter: ps => {
        const k = ps[0].dataIndex, o = ohlc[k];
        let out = `<b>${fmtDate(dates[k])}</b><br>O ${nf(o[0])} &nbsp;H ${nf(o[3])}<br>L ${nf(o[2])} &nbsp;C <b>${nf(o[1])}</b> ${chg(k ? o[1] / ohlc[k - 1][1] - 1 : 0)}<br>Volume ${nf(vols[k].value, 0)}`;
        if (rs[k] != null) out += `<br>RSI ${nf(rs[k], 1)}`;
        ps.filter(x => x.seriesType === "line" && x.seriesName !== "RSI" && x.value != null).forEach(x => { out += `<br>${x.marker}${x.seriesName} ${nf(x.value)}`; });
        return out;
      } },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [{ left: 60, right: 18, top: 34, height: "56%" }, { left: 60, right: 18, top: "71%", height: "11%" }, { left: 60, right: 18, top: "86%", height: "10%" }],
    xAxis: [0, 1, 2].map(g => xCat(t, dates, { gridIndex: g, axisLabel: { show: g === 2, color: t.muted, fontSize: 11, formatter: v => fmtShort(v) }, axisLine: { lineStyle: { color: t.axis } } })),
    yAxis: [yVal(t, v => nf(v, 0), { gridIndex: 0 }),
      yVal(t, v => v >= 1e7 ? (v / 1e7).toFixed(1) + "Cr" : (v / 1e5).toFixed(0) + "L", { gridIndex: 1, scale: false, splitNumber: 2 }),
      yVal(t, v => v, { gridIndex: 2, min: 0, max: 100, interval: 50, scale: false })],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1, 2] }],
    series: [
      { name: "Price", type: "candlestick", data: ohlc, itemStyle: { color: t.up, color0: t.down, borderColor: t.up, borderColor0: t.down } },
      ...ovSeries,
      { name: "Volume", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: "70%" },
      { name: "RSI", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: rs, showSymbol: false, lineStyle: { width: 1.5, color: t.s[6] },
        markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid" }, label: { color: t.muted, fontSize: 10 }, data: [{ yAxis: 30 }, { yAxis: 70 }] } },
    ],
  }));

  el("stFund").innerHTML = [
    ["Market cap", cr(s.mcap_cr)], ["P/E", nf(s.pe, 1)], ["P/B", nf(s.pb, 2)], ["EPS (₹)", nf(s.eps, 2)],
    ["Dividend yield", s.div_yield == null ? "—" : nf(s.div_yield, 2) + "%"], ["Beta", nf(s.beta, 2)],
    ["ROE", s.roe == null ? "—" : pctu(s.roe)], ["Debt / equity", s.de == null ? "—" : nf(s.de / 100, 2)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  const parts = [["Promoters & insiders", s.promoter_pct, t.s[0]], ["Institutions (FII + DII + MF)", s.institutions_pct, t.s[1]], ["Public & others", s.public_pct, t.s[2]]];
  const funds = D.holdings.filter(hh => hh.symbol === sym && hh.value_cr > 0).sort((a, b) => b.stake_pct - a.stake_pct);
  el("stShare").innerHTML = `<div class="stack">${parts.map(([k, v, cc]) => `<div style="flex:${Math.max(v, 0.001)};background:${cc}" title="${k}">${v > 0.08 ? pctu(v, 0) : ""}</div>`).join("")}</div>
    <div class="legend">${parts.map(([k, v, cc]) => `<span><i style="background:${cc}"></i>${k} <b>${pctu(v)}</b></span>`).join("")}</div>
    <p class="sub" style="margin-top:14px;font-weight:600;color:var(--text)">Top fund holders <span class="badge b-neu">modelled</span></p>
    ${funds.length ? `<table><tbody>${funds.slice(0, 4).map(f => `<tr><td>${esc(f.fund)}</td><td class="num">${pctu(f.stake_pct / 100, 2)}</td></tr>`).join("")}</tbody></table>
    <p class="note"><a href="#holdings" id="toHold">See all ${funds.length} funds →</a></p>` : `<p class="note">None of the tracked funds hold ${sym}.</p>`}`;
  const th = el("toHold"); if (th) th.onclick = () => { state.hMode = "By company"; state.hStock = sym; save(); };

  const rules = [
    ["Price above 50-day average", s.sma50_gap > 0, pct(s.sma50_gap, 1)],
    ["50-day above 200-day average", (1 + s.sma200_gap) / (1 + s.sma50_gap) > 1, pct((1 + s.sma200_gap) / (1 + s.sma50_gap) - 1, 1)],
    ["MACD histogram", s.macd_hist > 0, s.macd_hist > 0 ? "positive" : "negative"],
    ["RSI (14)", s.rsi < 30 ? true : s.rsi > 70 ? false : null, nf(s.rsi, 1)],
    ["3-month momentum", s.mom63 > 0.05 ? true : s.mom63 < -0.05 ? false : null, pct(s.mom63, 1)],
  ];
  const w = (s.score + 5) / 10;
  el("stSignal").innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">${sigBadge(s.signal)}<b style="font-size:20px">${s.score > 0 ? "+" : ""}${s.score}</b></div>
    <div class="meter"><i style="left:0;width:${w * 100}%;background:${s.score > 0 ? t.up : s.score < 0 ? t.down : t.muted}"></i></div>
    <ul class="checks" style="margin-top:12px">${rules.map(([k, ok, v]) => `<li><span>${ok === true ? '<span class="up">✓</span>' : ok === false ? '<span class="down">✗</span>' : '<span class="mut">–</span>'} ${k}</span><b>${v}</b></li>`).join("")}</ul>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--grid)"><div style="display:flex;justify-content:space-between"><span>ML: chance of higher close in 20 sessions</span><b>${pctu(s.p_up_20d, 0)}</b></div>
    <p class="note">The model scored AUC ${D.ml.models.find(m => m.name === D.ml.chosen).auc} on unseen data (0.50 = coin toss), so treat it as a screen, not a forecast.</p></div>`;

  // Monte Carlo fan
  const mc = s.mc, hist = 60, hd = CAL.slice(N - hist), hv = p.c.slice(-hist);
  const steps = mc.p50.map((_, k) => `T+${(k + 1) * mc.step}`);
  const xs = [...hd, ...steps], pad = new Array(hist - 1).fill(null), lastV = p.c[p.c.length - 1];
  const fan = (lo, hi, name, a) => [
    { name: name + "lo", type: "line", data: [...pad, lastV, ...lo], stack: name, lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    { name, type: "line", data: [...pad, 0, ...hi.map((x, k) => x - lo[k])], stack: name, lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: alpha(t.s[0], a) }, silent: true, tooltip: { show: false } },
  ];
  chart("stMC", base(t, {
    tooltip: { ...base(t).tooltip, formatter: ps => {
      const k = ps[0].dataIndex;
      if (k < hist) return `${fmtDate(xs[k])}<br>Close <b>${nf(hv[k])}</b>`;
      const q = k - hist;
      return `<b>${xs[k]} sessions</b><br>95%: ${nf(mc.p95[q])}<br>75%: ${nf(mc.p75[q])}<br>Median: <b>${nf(mc.p50[q])}</b><br>25%: ${nf(mc.p25[q])}<br>5%: ${nf(mc.p5[q])}`;
    } },
    xAxis: xCat(t, xs, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => v.startsWith("T+") ? v : fmtShort(v) } }),
    yAxis: yVal(t, v => nf(v, 0)),
    series: [...fan(mc.p5, mc.p95, "5–95%", 0.12), ...fan(mc.p25, mc.p75, "25–75%", 0.22),
      { name: "Close", type: "line", data: hv, showSymbol: false, lineStyle: { width: 2, color: t.text2 } },
      { name: "Median path", type: "line", data: [...pad, lastV, ...mc.p50], showSymbol: false, lineStyle: { width: 2, color: t.s[0], type: [6, 4] } }],
    graphic: [{ type: "text", right: 24, top: 10, style: { text: `Median in 60 sessions: ${pct(mc.exp_return, 1)} · chance of gain ${pctu(mc.prob_up, 0)}`, fill: t.text2, fontSize: 12 } }],
  }));

  const peers = D.stocks.filter(x => x.sector === s.sector).map(x => ({ x, r: stockRet(x.sym, i0r, i1) })).sort((a, b) => b.r - a.r);
  el("stPeers").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Return</th><th>Signal</th></tr></thead><tbody>${peers.map(({ x, r: rr }) =>
    `<tr class="click ${x.sym === sym ? "sel" : ""}" data-sym="${x.sym}"><td class="name-cell"><b>${x.sym}</b><span>${esc(x.name)}</span></td><td class="num">${chg(rr, 1)}</td><td>${sigBadge(x.signal)}</td></tr>`).join("")}</tbody></table>`;
};

// ================================================================= FLOW
RENDER.flow = function () {
  const t = T(), [i0, i1] = rangeIdx();
  const rows = D.stocks.map(s => ({ s, ...flowSum(s.sym, i0, i1), r: stockRet(s.sym, i0, i1) }));
  const tot = sum(rows.map(r => r.turnover)), net = sum(rows.map(r => r.net));
  const byNet = [...rows].sort((a, b) => b.net - a.net);
  el("flTiles").innerHTML = [
    tile("Total turnover", cr(tot), `${i1 - i0 + 1} sessions · 51 stocks`),
    tile("Net buying", `<span class="${cls(net)}">${cr(net)}</span>`, `${pctu(net / tot)} of turnover`),
    tile("Stocks net bought", `<span class="up">${rows.filter(r => r.net > 0).length}</span>`, `${rows.filter(r => r.net < 0).length} net sold`),
    tile("Most bought", byNet[0].s.sym, cr(byNet[0].net)),
    tile("Most sold", byNet[byNet.length - 1].s.sym, cr(byNet[byNet.length - 1].net)),
  ].join("");

  const barH = (id, list, color) => chart(id, base(t, {
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => { const r = list[list.length - 1 - p[0].dataIndex]; return `<b>${r.s.name}</b><br>Net: ${cr(r.net)}<br>Bought ${cr(r.buy)} · Sold ${cr(r.sell)}<br>Price ${chg(r.r)}`; } },
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    xAxis: yVal(t, v => nf(v, 0), { scale: false }), yAxis: xCat(t, [...list].reverse().map(r => r.s.sym)),
    series: [{ type: "bar", barWidth: "60%", data: [...list].reverse().map(r => Math.abs(r.net)), itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => cr(p.value) } }],
  }));
  const bought = byNet.filter(r => r.net > 0).slice(0, 10), sold = byNet.filter(r => r.net < 0).reverse().slice(0, 10);
  barH("flBought", bought, t.up);
  barH("flSold", sold, t.down);
  charts.flBought.off("click"); charts.flBought.on("click", p => { state.flStock = p.name; save(); RENDER.flow(); });
  charts.flSold.off("click"); charts.flSold.on("click", p => { state.flStock = p.name; save(); RENDER.flow(); });

  // one stock, weekly (or monthly for long periods)
  const sel = el("flStock");
  sel.innerHTML = D.stocks.map(s => `<option value="${s.sym}" ${s.sym === state.flStock ? "selected" : ""}>${s.sym} · ${esc(s.name)}</option>`).join("");
  sel.onchange = () => { state.flStock = sel.value; save(); RENDER.flow(); };
  const sym = state.flStock, f = flow(sym), ps = P(sym).s, monthly = i1 - i0 > 300;
  const buckets = new Map();
  for (let i = Math.max(i0, ps); i <= i1; i++) {
    const d = new Date(CAL[i] + "T00:00:00");
    let key;
    if (monthly) key = CAL[i].slice(0, 7);
    else { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); key = isoLocal(m); }
    const b = buckets.get(key) || { buy: 0, sell: 0 }; b.buy += f.buy[i - ps]; b.sell += f.sell[i - ps]; buckets.set(key, b);
  }
  const keys = [...buckets.keys()];
  el("flStockTitle").textContent = `Buying vs selling · ${sym}`;
  chart("flStockChart", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `<b>${monthly ? p[0].axisValue : "Week of " + fmtShort(p[0].axisValue)}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${cr(Math.abs(x.value))}`).join("<br>")}` },
    xAxis: xCat(t, keys, { axisLabel: { color: t.muted, fontSize: 11, formatter: v => monthly ? v : fmtShort(v) } }),
    yAxis: yVal(t, v => nf(v, 0), { scale: false }),
    series: [
      { name: "Bought", type: "bar", stack: "x", data: keys.map(k => +buckets.get(k).buy.toFixed(1)), itemStyle: { color: t.up, borderRadius: [3, 3, 0, 0] } },
      { name: "Sold", type: "bar", stack: "x", data: keys.map(k => -buckets.get(k).sell.toFixed(1)), itemStyle: { color: t.down, borderRadius: [0, 0, 3, 3] } },
      { name: "Net", type: "line", data: keys.map(k => +(buckets.get(k).buy - buckets.get(k).sell).toFixed(1)), showSymbol: false, lineStyle: { width: 2, color: t.s[0] }, itemStyle: { color: t.s[0] } },
    ],
  }));

  const sec = {};
  rows.forEach(r => { sec[r.s.sector] = (sec[r.s.sector] || 0) + r.net; });
  const secs = Object.entries(sec).sort((a, b) => a[1] - b[1]);
  chart("flSector", base(t, {
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: <b>${cr(p[0].value)}</b>` },
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    xAxis: yVal(t, v => nf(v, 0), { scale: false }), yAxis: xCat(t, secs.map(x => x[0])),
    series: [{ type: "bar", barWidth: "60%", data: secs.map(([, v]) => ({ value: +v.toFixed(1), itemStyle: { color: v >= 0 ? t.up : t.down, borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => cr(p.value) } }],
  }));

  const shock = D.stocks.map(s => {
    const p = P(s.sym), n = p.v.length, avg = sum(p.v.slice(n - 21, n - 1)) / 20;
    return { s, x: p.v[n - 1] / avg, v: p.v[n - 1], c: dayChg(s.sym) };
  }).sort((a, b) => b.x - a.x).slice(0, 8);
  el("flShock").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Volume</th><th class="num">vs 20-day avg</th><th class="num">Price</th></tr></thead><tbody>${shock.map(r =>
    `<tr class="click" data-sym="${r.s.sym}"><td class="name-cell"><b>${r.s.sym}</b><span>${esc(r.s.name)}</span></td><td class="num">${nf(r.v, 0)}</td><td class="num"><b>${nf(r.x, 1)}×</b></td><td class="num">${chg(r.c)}</td></tr>`).join("")}</tbody></table>`;
  el("flTable").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Turnover</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Net</th><th class="num">Return</th></tr></thead><tbody>${byNet.map(r =>
    `<tr class="click" data-sym="${r.s.sym}"><td><b>${r.s.sym}</b></td><td class="num">${cr(r.turnover)}</td><td class="num">${cr(r.buy)}</td><td class="num">${cr(r.sell)}</td><td class="num ${cls(r.net)}">${cr(r.net)}</td><td class="num">${chg(r.r, 1)}</td></tr>`).join("")}</tbody></table>`;

  // FII / DII
  const [a, b] = [CAL[i0], CAL[i1]];
  const fl = D.flows.filter(x => x.date >= a && x.date <= b);
  const fn = sum(fl.map(x => x.fii_net)), dn = sum(fl.map(x => x.dii_net));
  el("fiiTiles").innerHTML = [
    tile("FII / FPI net", `<span class="${cls(fn)}">${cr(fn)}</span>`, `${fl.filter(x => x.fii_net > 0).length} of ${fl.length} days net buyers`),
    tile("DII net", `<span class="${cls(dn)}">${cr(dn)}</span>`, `${fl.filter(x => x.dii_net > 0).length} of ${fl.length} days net buyers`),
    tile("Latest FII", `<span class="${cls(fl[fl.length - 1].fii_net)}">${cr(fl[fl.length - 1].fii_net)}</span>`, fmtDate(fl[fl.length - 1].date)),
    tile("Latest DII", `<span class="${cls(fl[fl.length - 1].dii_net)}">${cr(fl[fl.length - 1].dii_net)}</span>`, fmtDate(fl[fl.length - 1].date)),
  ].join("");
  const agg = fl.length > 130;
  const g = new Map();
  fl.forEach(x => { const k = agg ? x.date.slice(0, 7) : x.date; const o = g.get(k) || { f: 0, d: 0 }; o.f += x.fii_net; o.d += x.dii_net; g.set(k, o); });
  const gk = [...g.keys()];
  el("fiiSub").textContent = agg ? "Monthly totals, ₹ Cr" : "Daily, ₹ Cr";
  chart("fiiBars", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `<b>${agg ? p[0].axisValue : fmtDate(p[0].axisValue)}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${cr(x.value)}`).join("<br>")}` },
    xAxis: xCat(t, gk, { axisLabel: { color: t.muted, fontSize: 11, formatter: v => agg ? v : fmtShort(v) } }),
    yAxis: yVal(t, v => nf(v, 0), { scale: false }),
    series: [{ name: "FII / FPI", type: "bar", data: gk.map(k => +g.get(k).f.toFixed(0)), itemStyle: { color: t.s[0], borderRadius: 2 } },
      { name: "DII", type: "bar", data: gk.map(k => +g.get(k).d.toFixed(0)), itemStyle: { color: t.s[1], borderRadius: 2 } }],
  }));
  let cf = 0, cd = 0;
  const cum = fl.map(x => [cf += x.fii_net, cd += x.dii_net]);
  chart("fiiCum", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4 },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].axisValue)}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${cr(x.value)}`).join("<br>")}` },
    xAxis: xCat(t, fl.map(x => x.date), { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } }),
    yAxis: yVal(t, v => nf(v / 1000, 0) + "k", { scale: false }),
    series: [{ name: "FII / FPI", type: "line", data: cum.map(x => +x[0].toFixed(0)), showSymbol: false, lineStyle: { width: 2, color: t.s[0] }, itemStyle: { color: t.s[0] } },
      { name: "DII", type: "line", data: cum.map(x => +x[1].toFixed(0)), showSymbol: false, lineStyle: { width: 2, color: t.s[1] }, itemStyle: { color: t.s[1] } }],
  }));
};

// ================================================================= F&O
const ncdf = x => { const k = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * k * (0.3193815 + k * (-0.3565638 + k * (1.781478 + k * (-1.821256 + k * 1.330274)))); return x > 0 ? 1 - p : p; };
function curExp() { const u = D.options[state.fno]; return u.expiries[Math.min(state.expiry, u.expiries.length - 1)]; }
function legPremium(leg) { const row = curExp().chain.find(r => r.strike === leg.strike); return row ? row[leg.type].ltp : 0; }
function preset(name) {
  const u = D.options[state.fno], atm = Math.round(u.spot / u.step) * u.step, st = u.step * (u.is_index ? 4 : 3);
  const L = (side, type, k) => ({ side, type, strike: k, lots: 1 });
  return ({
    "Long Call": [L("B", "CE", atm)], "Long Put": [L("B", "PE", atm)],
    "Bull Call Spread": [L("B", "CE", atm), L("S", "CE", atm + st)], "Bear Put Spread": [L("B", "PE", atm), L("S", "PE", atm - st)],
    "Long Straddle": [L("B", "CE", atm), L("B", "PE", atm)], "Short Straddle": [L("S", "CE", atm), L("S", "PE", atm)],
    "Short Strangle": [L("S", "CE", atm + st), L("S", "PE", atm - st)],
    "Iron Condor": [L("S", "CE", atm + st), L("B", "CE", atm + 2 * st), L("S", "PE", atm - st), L("B", "PE", atm - 2 * st)],
  })[name] || [];
}

RENDER.fno = function () {
  const t = T(), names = Object.keys(D.options), u = D.options[state.fno];
  chips("fnoUnd", names, n => n === state.fno, v => { state.fno = v; state.expiry = 0; state.legs = preset("Long Straddle"); save(); RENDER.fno(); });
  const ex = curExp();
  seg("fnoExp", u.expiries.map(e => fmtShort(e.expiry)), fmtShort(ex.expiry), v => { state.expiry = u.expiries.findIndex(e => fmtShort(e.expiry) === v); save(); RENDER.fno(); });
  const pcr = ex.pcr, mood = pcr > 1.2 ? ["Bullish", "b-up"] : pcr < 0.8 ? ["Bearish", "b-down"] : ["Neutral", "b-neu"];
  el("fnoTiles").innerHTML = [
    tile("Spot", nf(u.spot), u.is_index ? "index close" : "NSE close"),
    tile("Futures (fair)", nf(u.fut), `basis ${nf(u.fut - u.spot)}`),
    tile("Put–call ratio", nf(pcr, 2), `<span class="badge ${mood[1]}">${mood[0]}</span>`),
    tile("Max pain", nf(ex.max_pain, 0), `${pct(ex.max_pain / u.spot - 1, 1)} from spot`),
    tile("ATM IV", nf(ex.atm_iv, 1) + "%", u.is_index ? "from India VIX" : "from 30-day realised vol"),
    tile("Lot size", nf(u.lot, 0), `1 lot ≈ ${inrShort(u.lot * u.spot)}`),
    tile("Days to expiry", ex.days, fmtDate(ex.expiry)),
    tile("Total OI", nf((ex.ce_oi + ex.pe_oi) / 1e5, 2) + " L", `CE ${nf(ex.ce_oi / 1e5, 2)} L · PE ${nf(ex.pe_oi / 1e5, 2)} L`),
  ].join("");

  const strikes = ex.chain.map(r => r.strike), atm = strikes.reduce((a, b) => Math.abs(b - u.spot) < Math.abs(a - u.spot) ? b : a);
  const ml = atm === ex.max_pain ? [{ xAxis: String(atm), label: { formatter: "Spot = max pain", color: t.text2 } }]
    : [{ xAxis: String(atm), label: { formatter: "Spot", color: t.text2 } }, { xAxis: String(ex.max_pain), label: { formatter: "Max pain", color: t.text2 } }];
  el("oiLegend").innerHTML = `<span><i style="background:${t.s[0]}"></i>Calls (CE)</span><span><i style="background:${t.s[1]}"></i>Puts (PE)</span>`;
  const oiOpt = key => base(t, {
    grid: { left: 8, right: 18, top: 24, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `<b>Strike ${p[0].axisValue}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${nf(x.value, 0)}`).join("<br>")}` },
    xAxis: xCat(t, strikes.map(String)), yAxis: yVal(t, v => Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + "L" : (v / 1e3).toFixed(0) + "k", { scale: false }),
    series: [{ name: "Calls", type: "bar", data: ex.chain.map(r => r.CE[key]), itemStyle: { color: t.s[0], borderRadius: 2 }, barGap: "10%",
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.muted, type: "solid" }, data: ml } },
    { name: "Puts", type: "bar", data: ex.chain.map(r => r.PE[key]), itemStyle: { color: t.s[1], borderRadius: 2 } }],
  });
  chart("fnoOI", oiOpt("oi"));
  chart("fnoChg", oiOpt("chg_oi"));

  seg("chainCols", ["Basic", "Greeks"], state.chainCols, v => { state.chainCols = v; save(); RENDER.fno(); });
  const maxOI = Math.max(...ex.chain.map(r => Math.max(r.CE.oi, r.PE.oi)));
  const g = state.chainCols === "Greeks";
  const ceCols = g ? ["delta", "gamma", "theta", "vega", "ltp"] : ["oi", "chg_oi", "volume", "iv", "ltp"];
  const peCols = g ? ["ltp", "delta", "gamma", "theta", "vega"] : ["ltp", "iv", "volume", "chg_oi", "oi"];
  const lab = { oi: "OI", chg_oi: "Chg OI", volume: "Volume", iv: "IV", ltp: "LTP", delta: "Delta", gamma: "Gamma", theta: "Theta", vega: "Vega" };
  const cell = (side, k, v, itm, strike) => {
    const c = `num ${itm ? "itm" : ""}`;
    if (k === "oi") return `<td class="${c} oi-bar ${side.toLowerCase()}"><i style="width:${v / maxOI * 100}%"></i><span>${nf(v, 0)}</span></td>`;
    if (k === "chg_oi") return `<td class="${c} ${cls(v)}">${nf(v, 0)}</td>`;
    if (k === "ltp") return `<td class="${c}"><span class="ltp" data-leg="${side}|${strike}" title="Add to strategy">${nf(v)}</span></td>`;
    if (k === "volume") return `<td class="${c}">${nf(v, 0)}</td>`;
    if (k === "gamma") return `<td class="${c}">${v.toFixed(5)}</td>`;
    return `<td class="${c}">${nf(v, k === "iv" ? 1 : 2)}</td>`;
  };
  el("fnoChain").innerHTML = `<table class="chain"><thead><tr><th class="side" colspan="5">CALLS</th><th class="side"></th><th class="side" colspan="5">PUTS</th></tr>
    <tr>${ceCols.map(k => `<th class="num">${lab[k]}</th>`).join("")}<th style="text-align:center">Strike</th>${peCols.map(k => `<th class="num">${lab[k]}</th>`).join("")}</tr></thead><tbody>
    ${ex.chain.map(r => `<tr class="${r.strike === atm ? "atm" : ""}">${ceCols.map(k => cell("CE", k, r.CE[k], r.strike < u.spot, r.strike)).join("")}<td class="strike">${nf(r.strike, 0)}</td>${peCols.map(k => cell("PE", k, r.PE[k], r.strike > u.spot, r.strike)).join("")}</tr>`).join("")}
    </tbody></table>`;
  el("fnoChain").onclick = e => {
    const x = e.target.closest("[data-leg]"); if (!x) return;
    const [type, k] = x.dataset.leg.split("|");
    state.legs.push({ side: "B", type, strike: +k, lots: 1 }); renderStrategy();
  };
  const sc = el("fnoChain"), row = sc.querySelector("tr.atm");
  if (row) sc.scrollTop = row.offsetTop - sc.clientHeight / 2;

  chart("fnoIV", base(t, {
    grid: { left: 8, right: 18, top: 12, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `Strike ${p[0].axisValue}: <b>${nf(p[0].value, 1)}%</b>` },
    xAxis: xCat(t, strikes.map(String), { boundaryGap: false }), yAxis: yVal(t, v => v + "%"),
    series: [{ type: "line", data: ex.chain.map(r => r.CE.iv), showSymbol: false, lineStyle: { width: 2, color: t.s[6] }, itemStyle: { color: t.s[6] },
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.muted, type: "solid" }, data: [{ xAxis: String(atm), label: { formatter: "ATM", color: t.text2 } }] } }],
  }));
  const hst = u.oi_history;
  chart("fnoPCR", base(t, {
    grid: { left: 8, right: 18, top: 12, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `${fmtDate(p[0].axisValue)}<br>PCR <b>${nf(p[0].value, 2)}</b><br>Spot ${nf(hst[p[0].dataIndex].spot)}` },
    xAxis: xCat(t, hst.map(h => h.date), { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } }), yAxis: yVal(t, v => v.toFixed(2)),
    series: [{ type: "line", data: hst.map(h => +(h.pe_oi / h.ce_oi).toFixed(3)), symbolSize: 8, lineStyle: { width: 2, color: t.s[0] }, itemStyle: { color: t.s[0], borderColor: t.surface, borderWidth: 2 },
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid" }, data: [{ yAxis: 1 }], label: { color: t.muted } } }],
  }));

  const presets = ["Custom", "Long Call", "Long Put", "Bull Call Spread", "Bear Put Spread", "Long Straddle", "Short Straddle", "Short Strangle", "Iron Condor"];
  el("stratPreset").innerHTML = presets.map(p => `<option>${p}</option>`).join("");
  el("stratPreset").onchange = e => { if (e.target.value !== "Custom") { state.legs = preset(e.target.value); renderStrategy(); } };
  if (!state.legs.length || state.legs.some(l => !strikes.includes(l.strike))) { state.legs = preset("Long Straddle"); el("stratPreset").value = "Long Straddle"; }
  renderStrategy();
};

function renderStrategy() {
  const t = T(), u = D.options[state.fno], ex = curExp(), strikes = ex.chain.map(r => r.strike);
  el("legs").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Action</th><th>Type</th><th>Strike</th><th class="num">Lots</th><th class="num">Premium</th><th></th></tr></thead><tbody>
    ${state.legs.map((l, i) => `<tr>
      <td><div class="seg" data-i="${i}" data-f="side"><button type="button" class="${l.side === "B" ? "on" : ""}" data-v="B">Buy</button><button type="button" class="${l.side === "S" ? "on" : ""}" data-v="S">Sell</button></div></td>
      <td><div class="seg" data-i="${i}" data-f="type"><button type="button" class="${l.type === "CE" ? "on" : ""}" data-v="CE">CE</button><button type="button" class="${l.type === "PE" ? "on" : ""}" data-v="PE">PE</button></div></td>
      <td><select data-i="${i}" data-f="strike">${strikes.map(k => `<option ${k === l.strike ? "selected" : ""}>${k}</option>`).join("")}</select></td>
      <td class="num"><input class="text-in" style="width:64px" type="number" min="1" value="${l.lots}" data-i="${i}" data-f="lots"></td>
      <td class="num">${nf(legPremium(l))}</td>
      <td><button type="button" class="btn sm" data-del="${i}" aria-label="Remove leg">✕</button></td></tr>`).join("")}
    </tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn sm" id="addLeg">+ Add leg</button><button type="button" class="btn sm" id="clearLegs">Clear</button></div>`;
  const box = el("legs");
  box.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "addLeg") { const atm = strikes.reduce((a, c) => Math.abs(c - u.spot) < Math.abs(a - u.spot) ? c : a); state.legs.push({ side: "B", type: "CE", strike: atm, lots: 1 }); }
    else if (b.id === "clearLegs") state.legs = [];
    else if (b.dataset.del != null) state.legs.splice(+b.dataset.del, 1);
    else { const sg = b.closest(".seg"); if (sg) state.legs[+sg.dataset.i][sg.dataset.f] = b.dataset.v; }
    el("stratPreset").value = "Custom"; renderStrategy();
  };
  box.onchange = e => {
    const x = e.target; if (x.dataset.i == null) return;
    state.legs[+x.dataset.i][x.dataset.f] = x.dataset.f === "lots" ? Math.max(1, +x.value || 1) : +x.value;
    el("stratPreset").value = "Custom"; renderStrategy();
  };

  if (!state.legs.length) { el("stratTiles").innerHTML = ""; chart("payoff", base(t, { graphic: [{ type: "text", left: "center", top: "middle", style: { text: "Add a leg to see the payoff", fill: t.muted, fontSize: 13 } }] })); return; }
  const legs = state.legs.map(l => ({ ...l, prem: legPremium(l), sgn: l.side === "B" ? 1 : -1 }));
  const pnl = S => sum(legs.map(l => l.sgn * l.lots * u.lot * (Math.max(0, l.type === "CE" ? S - l.strike : l.strike - S) - l.prem)));
  const w = u.is_index ? 0.08 : 0.15, lo = u.spot * (1 - w), hi = u.spot * (1 + w), n = 240;
  const xs = Array.from({ length: n + 1 }, (_, k) => lo + (hi - lo) * k / n), ys = xs.map(pnl);
  const net = -sum(legs.map(l => l.sgn * l.lots * u.lot * l.prem));
  const slopeR = sum(legs.map(l => l.type === "CE" ? l.sgn * l.lots : 0)), slopeL = sum(legs.map(l => l.type === "PE" ? -l.sgn * l.lots : 0));
  const atZero = pnl(0);
  const maxP = slopeR > 0 ? Infinity : Math.max(...ys, atZero), maxL = slopeR < 0 ? -Infinity : Math.min(...ys, atZero);
  const be = [];
  for (let k = 1; k < xs.length; k++) if ((ys[k - 1] < 0) !== (ys[k] < 0)) be.push(xs[k - 1] + (xs[k] - xs[k - 1]) * (-ys[k - 1]) / (ys[k] - ys[k - 1]));
  // probability of profit under a lognormal at ATM IV
  const T_ = Math.max(ex.days, 0.5) / 365, sg = ex.atm_iv / 100, mu = Math.log(u.spot) + (D.meta.risk_free - sg * sg / 2) * T_, sd = sg * Math.sqrt(T_);
  const cdf = S => ncdf((Math.log(S) - mu) / sd);
  let pop = 0;
  const pts = [0, ...xs, u.spot * 5];
  for (let k = 1; k < pts.length; k++) { const m = (pts[k - 1] + pts[k]) / 2; if (pnl(m) > 0) pop += cdf(pts[k]) - (pts[k - 1] > 0 ? cdf(pts[k - 1]) : 0); }
  void slopeL;
  el("stratTiles").innerHTML = [
    tile(net >= 0 ? "Net credit" : "Net debit", inrShort(Math.abs(net)), `${legs.length} leg${legs.length > 1 ? "s" : ""} · lot ${u.lot}`),
    tile("Max profit", maxP === Infinity ? '<span class="up">Unlimited</span>' : `<span class="up">${inrShort(maxP)}</span>`),
    tile("Max loss", maxL === -Infinity ? '<span class="down">Unlimited</span>' : `<span class="down">${inrShort(maxL)}</span>`),
    tile("Breakeven", be.length ? be.map(x => nf(x, 0)).join(" · ") : "—", be.length ? be.map(x => pct(x / u.spot - 1, 1)).join(" · ") : ""),
    tile("Chance of profit", pctu(pop, 0), "lognormal at ATM IV"),
  ].join("");
  chart("payoff", base(t, {
    grid: { left: 8, right: 18, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => { const v = p[0].value[1] + p[1].value[1]; return `Spot at expiry <b>${nf(p[0].value[0], 0)}</b> (${pct(p[0].value[0] / u.spot - 1, 1)})<br>P&amp;L <b class="${cls(v)}">${inrShort(v)}</b>`; } },
    xAxis: { type: "value", min: lo, max: hi, axisLine: { lineStyle: { color: t.axis } }, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: v => nf(v, 0) } },
    yAxis: yVal(t, v => inrShort(v), { scale: false }),
    series: [
      { name: "Profit", type: "line", data: xs.map((x, k) => [x, Math.max(0, Math.round(ys[k]))]), showSymbol: false, lineStyle: { width: 2, color: t.up }, itemStyle: { color: t.up }, areaStyle: { color: alpha(t.up, 0.14) },
        markLine: { silent: true, symbol: "none", lineStyle: { color: t.muted, type: "solid" }, data: [{ xAxis: u.spot, label: { formatter: "Spot", color: t.text2 } }] } },
      { name: "Loss", type: "line", data: xs.map((x, k) => [x, Math.min(0, Math.round(ys[k]))]), showSymbol: false, lineStyle: { width: 2, color: t.down }, itemStyle: { color: t.down }, areaStyle: { color: alpha(t.down, 0.14) } }],
  }));
}

// ================================================================= FUNDS
function navIndexed(code, a, b) {
  const s = navSeries(code); let k0 = s.d.findIndex(d => d >= a); if (k0 < 0) return [];
  const out = []; for (let k = k0; k < s.d.length && s.d[k] <= b; k++) out.push([s.d[k], +(s.n[k] / s.n[k0] * 100).toFixed(2)]);
  return out;
}
function xirr(flows) {
  let lo = -0.99, hi = 5, mid = 0;
  const t0 = new Date(flows[0][0]).getTime();
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const v = sum(flows.map(([d, f]) => f / Math.pow(1 + mid, (new Date(d).getTime() - t0) / 3.15576e10)));
    if (v > 0) lo = mid; else hi = mid;
  }
  return mid;
}

// ---------------------------------------------------------------- any fund: live search + metrics in the browser
const MFAPI = "https://api.mfapi.in/mf";
const TRACKED = new Set(D.funds.map(f => f.scheme_code));
const CATS = [["large & mid", "Large & Mid Cap"], ["small cap", "Small Cap"], ["mid cap", "Mid Cap"], ["large cap", "Large Cap"],
  ["flexi cap", "Flexi Cap"], ["multi cap", "Multi Cap"], ["focused", "Focused"], ["elss", "ELSS (Tax Saver)"], ["value", "Value"],
  ["contra", "Contra"], ["balanced advantage", "Balanced Advantage"], ["dynamic asset", "Balanced Advantage"], ["multi asset", "Multi Asset"],
  ["arbitrage", "Arbitrage"], ["aggressive hybrid", "Aggressive Hybrid"], ["conservative hybrid", "Conservative Hybrid"],
  ["sectoral", "Sectoral / Thematic"], ["thematic", "Sectoral / Thematic"], ["liquid", "Liquid"], ["overnight", "Overnight"],
  ["money market", "Money Market"], ["corporate bond", "Corporate Bond"], ["gilt", "Gilt"], ["short duration", "Short Duration"],
  ["short term", "Short Duration"], ["credit risk", "Credit Risk"], ["dynamic bond", "Dynamic Bond"]];
const DEBT = new Set(["Liquid", "Overnight", "Money Market", "Corporate Bond", "Gilt", "Short Duration", "Credit Risk", "Dynamic Bond"]);
const HYBRID = new Set(["Balanced Advantage", "Multi Asset", "Arbitrage", "Aggressive Hybrid", "Conservative Hybrid"]);
function catOf(raw, name) {
  const low = name.toLowerCase(), r = (raw || "").toLowerCase();
  if (/gold|silver/.test(low)) return "Gold";
  if (/nasdaq|s&p 500|us equity|global|international|overseas/.test(low)) return "International";
  if (/index|etf/.test(r)) return /smallcap|small cap/.test(low) ? "Index - Small Cap" : /midcap|mid cap/.test(low) ? "Index - Mid Cap" : "Index - Large Cap";
  const hit = CATS.find(([k]) => r.includes(k));
  return hit ? hit[1] : (raw || "Other").replace(/^.*? - /, "");
}
const assetOf = c => DEBT.has(c) ? "Debt" : HYBRID.has(c) ? "Hybrid" : (c === "Gold" || c === "International") ? "Gold & International" : "Equity";
const shortFund = n => n.split(/\s*-?\s*(Direct|Regular)/i)[0].replace(/\(erstwhile[^)]*\)/i, "").trim().split(/\s+/)
  .map(w => /^[A-Z]{4,}$/.test(w) && !["HDFC", "ICICI", "ELSS", "NASDAQ", "PPFAS"].includes(w) ? w[0] + w.slice(1).toLowerCase() : w).join(" ");
function bisectR(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; }
function fundStats(code, meta, d, n) {
  const asof = d[d.length - 1], last = n[n.length - 1];
  const back = days => { const t = new Date(asof + "T00:00:00"); t.setDate(t.getDate() - days); return isoLocal(t); };
  const navOn = iso => { const k = bisectR(d, iso) - 1; return k >= 0 ? n[k] : null; };
  const ret = days => { const v = navOn(back(days)); return v ? last / v - 1 : null; };
  const cagr = y => d[0] <= back(Math.round(365.25 * y)) ? Math.pow(last / navOn(back(Math.round(365.25 * y))), 1 / y) - 1 : null;
  const k0 = Math.max(0, bisectR(d, back(1096)) - 1);
  const lr = []; for (let k = k0 + 1; k < n.length; k++) lr.push(Math.log(n[k] / n[k - 1]));
  const mean = a => sum(a) / Math.max(1, a.length), sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const vol = sd(lr) * Math.sqrt(252), down = sd(lr.filter(x => x < 0)) * Math.sqrt(252);
  let peak = n[k0], mdd = 0; for (let k = k0; k < n.length; k++) { peak = Math.max(peak, n[k]); mdd = Math.min(mdd, n[k] / peak - 1); }
  const nifty = {}; CAL.forEach((c, i) => { if (D.indices["NIFTY 50"][i] != null) nifty[c] = D.indices["NIFTY 50"][i]; });
  const fx = [], nx = [];
  for (let k = k0 + 1; k < n.length; k++) if (nifty[d[k]] && nifty[d[k - 1]]) { fx.push(Math.log(n[k] / n[k - 1])); nx.push(Math.log(nifty[d[k]] / nifty[d[k - 1]])); }
  const mf = mean(fx), mn = mean(nx);
  const beta = nx.length > 30 ? sum(fx.map((x, i) => (x - mf) * (nx[i] - mn))) / sum(nx.map(x => (x - mn) ** 2)) : null;
  const roll = [];
  for (let k = k0; k < n.length; k++) { const t = new Date(d[k] + "T00:00:00"); t.setDate(t.getDate() - 365); const ti = isoLocal(t); if (d[0] <= ti) roll.push(n[k] / navOn(ti) - 1); }
  const c3 = cagr(3), rf = D.meta.risk_free;
  let seed = code % 2147483647 || 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = lr.slice(-756), H = 252, step = 21, cols = Array.from({ length: H / step }, () => []);
  for (let p = 0; p < 3000; p++) { let x = 0; for (let h = 1; h <= H; h++) { x += pick[Math.floor(rnd() * pick.length)]; if (h % step === 0) cols[h / step - 1].push(last * Math.exp(x)); } }
  const qq = (a, q) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(q * (s.length - 1))]; };
  const proj = { step, p5: cols.map(c => qq(c, .05)), p25: cols.map(c => qq(c, .25)), p50: cols.map(c => qq(c, .5)), p75: cols.map(c => qq(c, .75)), p95: cols.map(c => qq(c, .95)) };
  const fin = cols[cols.length - 1]; proj.prob_up = fin.filter(v => v > last).length / fin.length; proj.exp_return = qq(fin, .5) / last - 1;
  const category = catOf(meta.scheme_category, meta.scheme_name);
  const f = {
    scheme_code: code, fund: shortFund(meta.scheme_name), fund_house: meta.fund_house, category, asset_class: assetOf(category),
    aum_cr_approx: null, nav: last, nav_date: asof, r1m: ret(30), r3m: ret(91), r6m: ret(182), r1y: ret(365), cagr3y: c3, cagr5y: cagr(5),
    volatility: vol, sharpe: c3 == null ? null : (c3 - rf) / vol, sortino: c3 == null ? null : (c3 - rf) / down, max_drawdown: mdd, beta,
    roll1y_median: roll.length ? qq(roll, .5) : null, roll1y_min: roll.length ? Math.min(...roll) : null,
    roll1y_pct_positive: roll.length ? roll.filter(x => x > 0).length / roll.length : null, proj, external: true,
  };
  // score against tracked funds of the same asset class, same weights as the Python build
  const peers = D.funds.filter(x => !x.external && x.asset_class === f.asset_class);
  const pr = k => f[k] == null || !peers.length ? null : peers.filter(x => x[k] != null && x[k] <= f[k]).length / peers.length;
  const parts = [["cagr3y", .30], ["sharpe", .25], ["sortino", .10], ["max_drawdown", .15], ["roll1y_pct_positive", .10], ["r1y", .10]].map(([k, w]) => [pr(k), w]);
  f.score = parts.some(([v]) => v == null) ? null : sum(parts.map(([v, w]) => v * w)) * 100;
  f.stars = f.score == null ? 0 : Math.min(5, Math.max(1, Math.ceil(f.score / 20)));
  f.recommendation = f.score == null ? "Too new" : f.score >= 75 ? "Strong Buy" : f.score >= 55 ? "Buy" : f.score >= 40 ? "Hold" : "Review";
  f.risk = vol < .03 ? "Low" : vol < .10 ? "Moderate" : vol < .14 ? "Moderately High" : vol < .17 ? "High" : "Very High";
  return f;
}
async function loadFund(code) {
  if (FUND[code]) return FUND[code];
  const r = await fetch(`${MFAPI}/${code}`).then(x => { if (!x.ok) throw new Error(x.status); return x.json(); });
  const rows = r.data.map(x => [x.date.split("-").reverse().join("-"), +x.nav]).filter(x => x[1] > 0).sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (rows.length < 30) throw new Error("not enough NAV history");
  const d = rows.map(x => x[0]), n = rows.map(x => x[1]);
  const f = fundStats(code, r.meta, d, n);
  D.nav[code] = { d: d.map(x => Math.round((new Date(x + "T00:00:00").getTime() - EPOCH) / 864e5)), n };
  delete NAVD[code];
  D.funds.push(f); FUND[code] = f;
  return f;
}
let searchTimer = null, searchSeq = 0;
function setupFundSearch() {
  const box = el("mfSearch"), out = el("mfResults");
  if (box.dataset.ready) return;
  box.dataset.ready = "1";
  const run = async () => {
    const q = box.value.trim(), seq = ++searchSeq;
    if (q.length < 3) { out.innerHTML = ""; return; }
    out.innerHTML = '<p class="note">Searching AMFI schemes…</p>';
    try {
      let res = await fetch(`${MFAPI}/search?q=${encodeURIComponent(q)}`).then(x => x.json());
      if (seq !== searchSeq) return;
      if (el("mfDirectOnly").checked) res = res.filter(x => /direct/i.test(x.schemeName) && /growth/i.test(x.schemeName) && !/idcw|dividend|bonus/i.test(x.schemeName));
      out.innerHTML = res.length ? `<table><tbody>${res.slice(0, 12).map(x => `<tr class="click" data-add="${x.schemeCode}"><td class="name-cell"><b>${esc(x.schemeName)}</b><span>AMFI code ${x.schemeCode}${TRACKED.has(x.schemeCode) ? " · already in the screener" : ""}</span></td><td class="num"><span class="badge b-acc">Analyse →</span></td></tr>`).join("")}</tbody></table>${res.length > 12 ? `<p class="note">${res.length - 12} more matches: type more of the name.</p>` : ""}`
        : '<p class="note">No matching scheme. Try fewer words, or untick "Direct plan, growth option only".</p>';
    } catch (e) { out.innerHTML = '<p class="note">Could not reach the AMFI data service (api.mfapi.in). Check your connection and try again.</p>'; }
  };
  box.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 350); };
  el("mfDirectOnly").onchange = run;
  out.onclick = async e => {
    const r = e.target.closest("[data-add]"); if (!r) return;
    const code = +r.dataset.add;
    r.querySelector(".badge").textContent = "Loading…";
    try {
      await loadFund(code);
      state.extFunds = state.extFunds || [];
      if (!TRACKED.has(code) && !state.extFunds.includes(code)) state.extFunds.push(code);
      state.fund = code; state.mfCat = "All"; save();
      out.innerHTML = ""; box.value = "";
      RENDER.funds();
      el("mfHead").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) { r.querySelector(".badge").textContent = "No data"; }
  };
}

RENDER.funds = function () {
  const t = T(), [i0, i1] = rangeIdx(), a = CAL[i0], b = CAL[i1];
  setupFundSearch();
  const cats = ["All", ...[...new Set(D.funds.map(f => f.category))].sort()];
  chips("mfCats", cats, c => c === state.mfCat, v => { state.mfCat = v; save(); RENDER.funds(); });
  const [sk, sd] = state.mfSort;
  const list = D.funds.filter(f => state.mfCat === "All" || f.category === state.mfCat).sort((x, y) => ((x[sk] ?? -9) > (y[sk] ?? -9) ? 1 : -1) * sd);
  const cols = [["fund", "Fund"], ["category", "Category"], ["nav", "NAV"], ["r1m", "1M"], ["r6m", "6M"], ["r1y", "1Y"], ["cagr3y", "3Y CAGR"], ["cagr5y", "5Y CAGR"],
    ["volatility", "Volatility"], ["sharpe", "Sharpe"], ["max_drawdown", "Max DD"], ["score", "Score"], ["recommendation", "Verdict"], ["risk", "Risk"]];
  const fmtC = (k, f) => {
    const v = f[k];
    if (k === "fund") return `<td class="name-cell"><b>${esc(v)}</b><span>${esc(f.fund_house)}${f.external ? ' · <span class="badge b-acc">searched</span>' : ""}</span></td>`;
    if (k === "category" || k === "risk") return `<td>${esc(v)}</td>`;
    if (k === "nav") return `<td class="num">${nf(v)}</td>`;
    if (k === "recommendation") return `<td>${recBadge(v)}</td>`;
    if (k === "score") return `<td class="num"><b>${nf(v, 0)}</b> <span style="color:${t.s[3]}">${"★".repeat(f.stars)}</span></td>`;
    if (k === "sharpe") return `<td class="num">${nf(v, 2)}</td>`;
    if (k === "volatility") return `<td class="num">${pctu(v)}</td>`;
    if (k === "max_drawdown") return `<td class="num down">${pct(v, 1)}</td>`;
    return `<td class="num ${cls(v)}">${pct(v, 1)}</td>`;
  };
  el("mfTable").innerHTML = `<table><thead><tr>${cols.map(([k, l]) => `<th class="sort ${["fund", "category", "recommendation", "risk"].includes(k) ? "" : "num"}" data-k="${k}">${l}${k === sk ? (sd > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${list.map(f => `<tr class="click ${f.scheme_code === state.fund ? "sel" : ""}" data-fund="${f.scheme_code}">${cols.map(([k]) => fmtC(k, f)).join("")}</tr>`).join("")}</tbody></table>`;
  el("mfTable").onclick = e => {
    const h = e.target.closest("th[data-k]");
    if (h) { const k = h.dataset.k; state.mfSort = [k, k === sk ? -sd : (["fund", "category"].includes(k) ? 1 : -1)]; save(); RENDER.funds(); return; }
    const r = e.target.closest("tr[data-fund]");
    if (r) { state.fund = +r.dataset.fund; state.cmp = state.cmp.filter(c => c !== state.fund); save(); RENDER.funds(); el("mfHead").scrollIntoView({ behavior: "smooth", block: "start" }); }
  };

  const f = FUND[state.fund] || D.funds[0];
  el("mfHead").innerHTML = `<div><div style="font-size:20px;font-weight:700">${esc(f.fund)}</div><div class="mut">${esc(f.fund_house)} · <span class="badge b-acc">${f.category}</span> <span class="badge b-neu">Risk: ${f.risk}</span> ${recBadge(f.recommendation)}</div></div>
    <div class="exch"><span>NAV</span><div class="px" id="liveNav">${rupee(f.nav, 4)}</div><div class="mut" id="liveNavDate">as of ${fmtDate(f.nav_date)}</div></div>
    <div class="exch"><span>RATING</span><div style="font-size:20px;color:${t.s[3]}">${stars(f.stars)}</div><div class="mut">score ${nf(f.score, 0)} / 100</div></div>
    <button type="button" class="btn" id="liveBtn">↻ Fetch latest NAV</button>`;
  el("liveBtn").onclick = async () => {
    el("liveBtn").textContent = "Fetching…";
    try {
      const r = await fetch(`https://api.mfapi.in/mf/${f.scheme_code}`).then(x => x.json());
      const [n0, n1] = r.data;
      const d = n0.date.split("-").reverse().join("-");
      el("liveNav").innerHTML = rupee(+n0.nav, 4);
      el("liveNavDate").innerHTML = `live · ${fmtDate(d)} · ${chg(+n0.nav / +n1.nav - 1)}`;
      el("liveBtn").textContent = "✓ Updated from AMFI";
    } catch (err) { el("liveBtn").textContent = "Offline: showing stored NAV"; }
  };
  el("mfTiles").innerHTML = [
    tile("1Y return", chg(f.r1y, 1)), tile("3Y CAGR", chg(f.cagr3y, 1)), tile("5Y CAGR", chg(f.cagr5y, 1)),
    tile("Sharpe ratio", nf(f.sharpe, 2), `risk-free ${pctu(D.meta.risk_free)}`), tile("Max drawdown (3Y)", `<span class="down">${pct(f.max_drawdown, 1)}</span>`),
    tile("Beta vs NIFTY", nf(f.beta, 2)), tile("Positive 1Y windows", pctu(f.roll1y_pct_positive, 0), `worst ${pct(f.roll1y_min, 1)}`),
    f.external ? tile("Data", "Live", "fetched from AMFI just now") : tile("AUM (approx.)", cr(f.aum_cr_approx)),
  ].join("");

  const cmpSel = el("mfCompare");
  cmpSel.innerHTML = `<option value="">+ Compare a fund</option>` + D.funds.filter(x => x.scheme_code !== f.scheme_code && !state.cmp.includes(x.scheme_code)).map(x => `<option value="${x.scheme_code}">${esc(x.fund)}</option>`).join("");
  cmpSel.onchange = () => { if (cmpSel.value && state.cmp.length < 3) { state.cmp.push(+cmpSel.value); save(); RENDER.funds(); } };
  const series = [{ code: f.scheme_code, name: f.fund, color: t.s[0], data: navIndexed(f.scheme_code, a, b) },
    ...state.cmp.map((c, k) => ({ code: c, name: FUND[c].fund, color: t.s[k + 1], data: navIndexed(c, a, b) }))];
  const ni = []; { let k0 = -1; for (let i = i0; i <= i1; i++) { const v = D.indices["NIFTY 50"][i]; if (v == null) continue; if (k0 < 0) k0 = v; ni.push([CAL[i], +(v / k0 * 100).toFixed(2)]); } }
  series.push({ name: "NIFTY 50 (price)", color: t.muted, data: ni });
  el("mfCmpChips").innerHTML = state.cmp.map((c, k) => `<button type="button" class="chip" data-rm="${c}"><span style="color:${t.s[k + 1]}">●</span> ${esc(FUND[c].fund)} ✕</button>`).join("");
  el("mfCmpChips").onclick = e => { const x = e.target.closest("[data-rm]"); if (x) { state.cmp = state.cmp.filter(c => c !== +x.dataset.rm); save(); RENDER.funds(); } };
  chart("mfGrowth", base(t, {
    legend: { top: 0, left: 0, textStyle: { color: t.text2, fontSize: 12 }, itemWidth: 12, itemHeight: 4, type: "scroll" },
    grid: { left: 8, right: 18, top: 34, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].value[0])}</b><br>${p.map(x => `${x.marker}${esc(x.seriesName)}: <b>${nf(x.value[1])}</b> (${pct(x.value[1] / 100 - 1, 1)})`).join("<br>")}` },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.axis } }, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
    yAxis: yVal(t, v => v),
    series: series.map(s => ({ name: s.name, type: "line", data: s.data, showSymbol: false, lineStyle: { width: s.code === f.scheme_code ? 2.4 : 1.8, color: s.color }, itemStyle: { color: s.color } })),
  }));

  // rolling 1Y return over the stored 5 years
  const s = navSeries(f.scheme_code), roll = [];
  for (let k = 0, j = 0; k < s.d.length; k++) {
    const target = new Date(s.d[k] + "T00:00:00"); target.setFullYear(target.getFullYear() - 1);
    const ti = isoLocal(target);
    if (s.d[0] > ti) continue;
    while (j + 1 < k && s.d[j + 1] <= ti) j++;
    roll.push([s.d[k], +((s.n[k] / s.n[j] - 1) * 100).toFixed(2)]);
  }
  chart("mfRoll", base(t, {
    grid: { left: 8, right: 18, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `1Y to ${fmtDate(p[0].value[0])}: <b class="${cls(p[0].value[1])}">${pct(p[0].value[1] / 100, 1)}</b>` },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.axis } }, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
    yAxis: yVal(t, v => v + "%", { scale: false }),
    series: [{ type: "line", data: roll, showSymbol: false, lineStyle: { width: 1.6, color: t.s[0] }, itemStyle: { color: t.s[0] }, areaStyle: { color: alpha(t.s[0], 0.1) },
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, type: "solid" }, label: { show: false }, data: [{ yAxis: 0 }] } }],
  }));

  // SIP calculator on real NAVs
  const amt = Math.max(500, +el("sipAmt").value || 10000);
  el("sipAmt").oninput = () => RENDER.funds();
  let units = 0, inv = 0, lastMonth = "";
  const pts = [], flows = [];
  for (let k = 0; k < s.d.length; k++) {
    const d = s.d[k]; if (d < a || d > b) continue;
    if (d.slice(0, 7) !== lastMonth) { lastMonth = d.slice(0, 7); units += amt / s.n[k]; inv += amt; flows.push([d, -amt]); pts.push([d, inv, +(units * s.n[k]).toFixed(0)]); }
  }
  let endK = s.d.length - 1; while (endK > 0 && s.d[endK] > b) endK--;
  const value = units * s.n[endK];
  if (pts.length) pts.push([s.d[endK], inv, +value.toFixed(0)]);
  flows.push([s.d[endK], value]);
  const xr = pts.length > 2 ? xirr(flows) : null;
  el("sipTiles").innerHTML = [tile("Invested", inrShort(inv), `${pts.length - 1} instalments`), tile("Value today", inrShort(value)),
    tile("Gain", `<span class="${cls(value - inv)}">${inrShort(value - inv)}</span>`, inv ? pct(value / inv - 1, 1) : ""), tile("XIRR", xr == null ? "—" : chg(xr, 1), "annualised")].join("");
  chart("sipChart", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4 },
    grid: { left: 8, right: 18, top: 28, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].value[0])}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${inrShort(x.value[1])}`).join("<br>")}` },
    xAxis: { type: "time", axisLine: { lineStyle: { color: t.axis } }, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
    yAxis: yVal(t, v => inrShort(v), { scale: false }),
    series: [{ name: "Value", type: "line", data: pts.map(x => [x[0], x[2]]), showSymbol: false, lineStyle: { width: 2, color: t.s[0] }, itemStyle: { color: t.s[0] }, areaStyle: { color: alpha(t.s[0], 0.1) } },
      { name: "Invested", type: "line", step: "end", data: pts.map(x => [x[0], x[1]]), showSymbol: false, lineStyle: { width: 1.6, color: t.muted }, itemStyle: { color: t.muted } }],
  }));

  // projection
  const lump = Math.max(1000, +el("lumpAmt").value || 100000);
  el("lumpAmt").oninput = () => RENDER.funds();
  const pr = f.proj, sc = v => v / f.nav * lump, months = ["Now", ...pr.p50.map((_, k) => `M${k + 1}`)];
  el("projTiles").innerHTML = [tile("Median in 1 year", inrShort(sc(pr.p50.at(-1))), pct(pr.exp_return, 1)),
    tile("Bad case (5%)", `<span class="down">${inrShort(sc(pr.p5.at(-1)))}</span>`), tile("Good case (95%)", `<span class="up">${inrShort(sc(pr.p95.at(-1)))}</span>`),
    tile("Chance of gain", pctu(pr.prob_up, 0))].join("");
  const band = (lo, hi, name, op) => [
    { name: name + "lo", type: "line", stack: name, data: [lump, ...lo.map(sc)], lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    { name, type: "line", stack: name, data: [0, ...hi.map((x, k) => sc(x) - sc(lo[k]))], lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: alpha(t.s[0], op) }, silent: true, tooltip: { show: false } }];
  chart("projChart", base(t, {
    grid: { left: 8, right: 18, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => { const k = p[0].dataIndex; if (!k) return `Now: ${inrShort(lump)}`; const q = k - 1; return `<b>Month ${k}</b><br>95%: ${inrShort(sc(pr.p95[q]))}<br>Median: <b>${inrShort(sc(pr.p50[q]))}</b><br>5%: ${inrShort(sc(pr.p5[q]))}`; } },
    xAxis: xCat(t, months, { boundaryGap: false }), yAxis: yVal(t, v => inrShort(v)),
    series: [...band(pr.p5, pr.p95, "5–95%", 0.12), ...band(pr.p25, pr.p75, "25–75%", 0.22),
      { name: "Median", type: "line", data: [lump, ...pr.p50.map(sc)], showSymbol: false, lineStyle: { width: 2, color: t.s[0], type: [6, 4] }, itemStyle: { color: t.s[0] } }],
  }));
};

// ================================================================= HOLDINGS
RENDER.holdings = function () {
  const t = T(), H = D.holdings;
  const held = new Set(D.holdings.map(h => h.scheme_code));
  const eqFunds = D.funds.filter(f => held.has(f.scheme_code));
  if (!eqFunds.some(f => f.scheme_code === state.hFund)) state.hFund = eqFunds[0].scheme_code;
  seg("hMode", ["By fund", "By company"], state.hMode, v => { state.hMode = v; save(); RENDER.holdings(); });
  const byF = state.hMode === "By fund";
  el("hFund").classList.toggle("hidden", !byF); el("hStock").classList.toggle("hidden", byF);
  el("hByFund").classList.toggle("hidden", !byF); el("hByStock").classList.toggle("hidden", byF);
  el("hFund").innerHTML = eqFunds.map(f => `<option value="${f.scheme_code}" ${f.scheme_code === state.hFund ? "selected" : ""}>${esc(f.fund)}</option>`).join("");
  el("hFund").onchange = e => { state.hFund = +e.target.value; save(); RENDER.holdings(); };
  const comps = [...new Map(H.map(h => [h.symbol, h.company])).entries()].sort((x, y) => x[1].localeCompare(y[1]));
  if (!comps.some(c => c[0] === state.hStock)) state.hStock = comps[0][0];
  el("hStock").innerHTML = comps.map(([s, n]) => `<option value="${s}" ${s === state.hStock ? "selected" : ""}>${esc(n)} (${s})</option>`).join("");
  el("hStock").onchange = e => { state.hStock = e.target.value; save(); RENDER.holdings(); };
  const changeBadge = c => `<span class="badge ${c === "New" || c === "Increased" ? "b-up" : c === "Unchanged" ? "b-neu" : "b-down"}">${c === "New" ? "★ New" : c === "Increased" ? "▲ Added" : c === "Reduced" ? "▼ Reduced" : c === "Exit" ? "✕ Exited" : "■ Same"}</span>`;

  if (byF) {
    const f = FUND[state.hFund], rows = H.filter(h => h.scheme_code === state.hFund).sort((a, b) => b.weight_pct - a.weight_pct);
    const live = rows.filter(r => r.value_cr > 0), top10 = sum(live.slice(0, 10).map(r => r.weight_pct));
    const cap = ["Large", "Mid", "Small"].map(c => sum(live.filter(r => r.cap_bucket === c).map(r => r.weight_pct)));
    el("hfTiles").innerHTML = [
      tile("Stocks held", live.length, `${rows.filter(r => r.change === "New").length} new · ${rows.filter(r => r.change === "Exit").length} exited`),
      tile("Top-10 weight", nf(top10, 1) + "%", "concentration"),
      tile("Equity value", cr(sum(live.map(r => r.value_cr))), `AUM ≈ ${cr(f.aum_cr_approx)}`),
      tile("Bought this month", `<span class="up">${cr(sum(rows.filter(r => r.change_cr > 0).map(r => r.change_cr)))}</span>`),
      tile("Sold this month", `<span class="down">${cr(sum(rows.filter(r => r.change_cr < 0).map(r => r.change_cr)))}</span>`),
    ].join("");
    el("hfTitle").textContent = `${f.fund} · portfolio`;
    const maxW = Math.max(...rows.map(r => r.weight_pct));
    el("hfTable").innerHTML = `<table><thead><tr><th>Company</th><th>Sector</th><th class="num">Weight</th><th class="num">Value</th><th class="num">Stake in company</th><th>This month</th><th class="num">Change</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name-cell"><b>${esc(r.company)}</b><span>${r.symbol} · ${r.cap_bucket} cap</span></td><td>${r.sector}</td>
        <td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><div class="meter" style="width:60px"><i style="left:0;width:${r.weight_pct / maxW * 100}%;background:${t.s[0]}"></i></div>${nf(r.weight_pct, 2)}%</div></td>
        <td class="num">${cr(r.value_cr)}</td><td class="num"><b>${nf(r.stake_pct, 2)}%</b></td><td>${changeBadge(r.change)}</td><td class="num ${cls(r.change_cr)}">${cr(r.change_cr)}</td></tr>`).join("")}</tbody></table>`;
    const secs = {}; live.forEach(r => { secs[r.sector] = (secs[r.sector] || 0) + r.weight_pct; });
    const se = Object.entries(secs).sort((a, b) => a[1] - b[1]);
    chart("hfSector", base(t, {
      tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: <b>${nf(p[0].value, 1)}%</b>` },
      grid: { left: 8, right: 46, top: 8, bottom: 8, containLabel: true },
      xAxis: yVal(t, v => v + "%", { scale: false }), yAxis: xCat(t, se.map(x => x[0])),
      series: [{ type: "bar", barWidth: "62%", data: se.map(x => +x[1].toFixed(2)), itemStyle: { color: t.s[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => nf(p.value, 1) + "%" } }],
    }));
    const cc = [t.s[0], t.s[1], t.s[2]];
    el("hfCap").innerHTML = `<div class="stack">${cap.map((v, k) => v > 0 ? `<div style="flex:${v};background:${cc[k]}">${v > 9 ? nf(v, 0) + "%" : ""}</div>` : "").join("")}</div>
      <div class="legend">${["Large", "Mid", "Small"].map((c, k) => `<span><i style="background:${cc[k]}"></i>${c} cap <b>${nf(cap[k], 1)}%</b></span>`).join("")}</div>`;
  } else {
    const sym = state.hStock, rows = H.filter(h => h.symbol === sym).sort((a, b) => b.stake_pct - a.stake_pct);
    const live = rows.filter(r => r.value_cr > 0), comp = rows[0];
    const netc = sum(rows.map(r => r.change_cr));
    el("hsTiles").innerHTML = [
      tile("Company", esc(comp.company), `${sym} · ${comp.sector} · ${comp.cap_bucket} cap`),
      tile("Held by tracked funds", nf(sum(live.map(r => r.stake_pct)), 2) + "%", `of the company, across ${live.length} funds`),
      tile("Value held", cr(sum(live.map(r => r.value_cr)))),
      tile("Net change this month", `<span class="${cls(netc)}">${cr(netc)}</span>`, `${rows.filter(r => r.change_cr > 0).length} added · ${rows.filter(r => r.change_cr < 0).length} cut`),
    ].join("");
    el("hsTitle").textContent = `Funds holding ${comp.company}`;
    const lr = [...live].reverse();
    chart("hsChart", base(t, {
      tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => { const r = lr[p[0].dataIndex]; return `<b>${esc(r.fund)}</b><br>Stake ${nf(r.stake_pct, 3)}% · ${cr(r.value_cr)}<br>${nf(r.weight_pct, 2)}% of the fund`; } },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: yVal(t, v => v + "%", { scale: false }), yAxis: xCat(t, lr.map(r => r.fund.replace(" Fund", "")), { axisLabel: { color: t.muted, fontSize: 11, width: 170, overflow: "truncate" } }),
      series: [{ type: "bar", barWidth: "62%", data: lr.map(r => r.stake_pct), itemStyle: { color: t.s[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => nf(p.value, 2) + "%" } }],
    }));
    el("hsTable").innerHTML = `<table><thead><tr><th>Fund</th><th class="num">Value</th><th class="num">Stake</th><th>This month</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name-cell"><b>${esc(r.fund)}</b><span>${nf(r.weight_pct, 2)}% of fund</span></td><td class="num">${cr(r.value_cr)}</td><td class="num">${nf(r.stake_pct, 2)}%</td><td>${changeBadge(r.change)}</td></tr>`).join("")}</tbody></table>`;
  }

  const agg = {};
  H.forEach(h => { const a = agg[h.symbol] || (agg[h.symbol] = { sym: h.symbol, name: h.company, chg: 0, stake: 0, n: 0 }); a.chg += h.change_cr; a.stake += h.stake_pct; if (h.value_cr > 0) a.n++; });
  const A = Object.values(agg);
  const lst = (arr, f) => `<table><tbody>${arr.map(a => `<tr class="click" data-hs="${a.sym}"><td class="name-cell"><b>${esc(a.name)}</b><span>${a.sym} · ${a.n} funds</span></td><td class="num">${f(a)}</td></tr>`).join("")}</tbody></table>`;
  el("hTopBuy").innerHTML = lst([...A].sort((x, y) => y.chg - x.chg).slice(0, 7), a => `<span class="up">${cr(a.chg)}</span>`);
  el("hTopSell").innerHTML = lst([...A].sort((x, y) => x.chg - y.chg).slice(0, 7), a => `<span class="down">${cr(a.chg)}</span>`);
  el("hTopOwn").innerHTML = lst([...A].sort((x, y) => y.stake - x.stake).slice(0, 7), a => `<b>${nf(a.stake, 2)}%</b>`);
  el("hOwnSub").textContent = `% of each company held by the ${eqFunds.length} tracked equity funds`;
  ["hTopBuy", "hTopSell", "hTopOwn"].forEach(id => { el(id).onclick = e => { const r = e.target.closest("[data-hs]"); if (r) { state.hMode = "By company"; state.hStock = r.dataset.hs; save(); RENDER.holdings(); } }; });
};

// ================================================================= ADVISOR
function simCorpus(sip, years, mu, sigma, n = 2000) {
  const m = years * 12, out = Array.from({ length: years + 1 }, () => []);
  const dm = Math.log(1 + mu) / 12 - sigma * sigma / 24, sm = sigma / Math.sqrt(12);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (let p = 0; p < n; p++) {
    let v = 0; out[0].push(0);
    for (let k = 1; k <= m; k++) { v = (v + sip) * Math.exp(dm + sm * gauss()); if (k % 12 === 0) out[k / 12].push(v); }
  }
  const q = (a, x) => { const s = [...a].sort((u, w) => u - w); return s[Math.floor(x * (s.length - 1))]; };
  return out.map(a => ({ p10: q(a, 0.1), p50: q(a, 0.5), p90: q(a, 0.9) }));
}

RENDER.advisor = function () {
  const t = T();
  const qs = ["qAge", "qHor", "qFall"].map(id => +el(id).value);
  const auto = sum(qs) <= 3 ? "Conservative" : sum(qs) <= 6 ? "Moderate" : "Aggressive";
  const prof = state.profile || auto;
  ["qAge", "qHor", "qFall"].forEach(id => { el(id).onchange = () => { state.profile = null; save(); RENDER.advisor(); }; });
  ["advSip", "advYears"].forEach(id => { el(id).oninput = () => RENDER.advisor(); });
  seg("advProfile", ["Conservative", "Moderate", "Aggressive"], prof, v => { state.profile = v; save(); RENDER.advisor(); });
  el("advNote").innerHTML = `Your answers suggest <b>${auto}</b>${state.profile && state.profile !== auto ? ` · you picked <b>${state.profile}</b>` : ""}.`;
  const P_ = D.portfolios[prof];
  el("advTitle").textContent = `${prof} model portfolio`;
  const cols = P_.items.map((_, k) => t.s[k]);
  chart("advDonut", {
    tooltip: { backgroundColor: t.surface, borderColor: t.axis, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${p.data.bucket}<br><b>${esc(p.name)}</b>: ${p.value}%` },
    series: [{ type: "pie", radius: ["58%", "86%"], avoidLabelOverlap: true, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: false },
      data: P_.items.map((x, k) => ({ name: x.fund, bucket: x.bucket, value: x.weight, itemStyle: { color: cols[k] } })) }],
    graphic: [{ type: "text", left: "center", top: "middle", style: { text: `${pctu(P_.blended_cagr3y, 1)}\nblended 3Y CAGR`, align: "center", fill: t.text, fontSize: 13, fontWeight: 600, lineHeight: 18 } }],
  });
  el("advTable").innerHTML = `<table><thead><tr><th>Bucket</th><th>Fund</th><th class="num">Weight</th><th class="num">3Y CAGR</th><th>Verdict</th></tr></thead><tbody>
    ${P_.items.map((x, k) => `<tr class="click" data-fund-go="${x.scheme_code}"><td><span style="color:${cols[k]}">●</span> ${x.bucket}</td><td class="name-cell"><b>${esc(x.fund)}</b><span>score ${nf(x.score, 0)}</span></td><td class="num">${x.weight}%</td><td class="num ${cls(x.cagr3y)}">${pct(x.cagr3y, 1)}</td><td>${recBadge(FUND[x.scheme_code].recommendation)}</td></tr>`).join("")}</tbody></table>`;
  el("advTable").onclick = e => { const r = e.target.closest("[data-fund-go]"); if (r) { state.fund = +r.dataset.fundGo; save(); location.hash = "funds"; } };

  const sip = Math.max(500, +el("advSip").value || 15000), yrs = Math.min(40, Math.max(1, +el("advYears").value || 10));
  const mu = P_.blended_cagr3y, sigma = sum(P_.items.map(x => x.weight / 100 * FUND[x.scheme_code].volatility));
  const sim = simCorpus(sip, yrs, mu, sigma), end = sim[yrs], invested = sip * 12 * yrs;
  el("advTiles").innerHTML = [tile("You invest", inrShort(invested), `${inrShort(sip)} × ${yrs * 12} months`),
    tile("Likely corpus (median)", `<span class="up">${inrShort(end.p50)}</span>`, `${nf(end.p50 / invested, 1)}× your money`),
    tile("Bad case (10%)", inrShort(end.p10)), tile("Good case (90%)", inrShort(end.p90)),
    tile("Assumed return / risk", `${pctu(mu, 1)} / ${pctu(sigma, 0)}`, "blended 3Y CAGR / volatility")].join("");
  const yl = sim.map((_, k) => `Year ${k}`);
  chart("advProj", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4, data: ["Median corpus", "Invested"] },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => { const k = p[0].dataIndex; return `<b>Year ${k}</b><br>Invested ${inrShort(sip * 12 * k)}<br>90%: ${inrShort(sim[k].p90)}<br>Median: <b>${inrShort(sim[k].p50)}</b><br>10%: ${inrShort(sim[k].p10)}`; } },
    xAxis: xCat(t, yl, { boundaryGap: false }), yAxis: yVal(t, v => inrShort(v), { scale: false }),
    series: [{ name: "lo", type: "line", stack: "b", data: sim.map(x => x.p10), lineStyle: { opacity: 0 }, showSymbol: false, silent: true },
      { name: "10–90%", type: "line", stack: "b", data: sim.map(x => x.p90 - x.p10), lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: alpha(t.s[0], 0.14) }, silent: true },
      { name: "Median corpus", type: "line", data: sim.map(x => Math.round(x.p50)), showSymbol: false, lineStyle: { width: 2.4, color: t.s[0] }, itemStyle: { color: t.s[0] } },
      { name: "Invested", type: "line", data: sim.map((_, k) => sip * 12 * k), showSymbol: false, lineStyle: { width: 1.6, color: t.muted }, itemStyle: { color: t.muted } }],
  }));

  seg("screenSeg", ["All", "Buy signals", "Sell signals"], state.screen, v => { state.screen = v; save(); RENDER.advisor(); });
  const st = D.stocks.filter(s => state.screen === "All" || (state.screen === "Buy signals" ? s.score > 0 : s.score < 0)).sort((a, b) => b.score - a.score || b.p_up_20d - a.p_up_20d);
  el("advStocks").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Price</th><th>Signal</th><th class="num">Score</th><th class="num">RSI</th><th class="num">3M</th><th class="num">ML P(up)</th><th class="num">MC 60d median</th></tr></thead><tbody>
    ${st.map(s => `<tr class="click" data-sym="${s.sym}"><td class="name-cell"><b>${s.sym}</b><span>${esc(s.name)}</span></td><td class="num">${nf(lastClose(s.sym))}</td><td>${sigBadge(s.signal)}</td><td class="num"><b>${s.score > 0 ? "+" : ""}${s.score}</b></td><td class="num">${nf(s.rsi, 0)}</td><td class="num">${chg(s.mom63, 1)}</td><td class="num">${pctu(s.p_up_20d, 0)}</td><td class="num">${chg(s.mc.exp_return, 1)}</td></tr>`).join("")}</tbody></table>`;
  el("advBT").innerHTML = `<table><thead><tr><th>Signal</th><th class="num">Cases</th><th class="num">Avg 20d</th><th class="num">Hit rate</th></tr></thead><tbody>
    ${D.signal_backtest.map(b => `<tr><td>${sigBadge(b.signal)}</td><td class="num">${nf(b.n, 0)}</td><td class="num">${chg(b.avg_fwd20, 2)}</td><td class="num">${pctu(b.hit_rate, 0)}</td></tr>`).join("")}</tbody></table>`;
  const ml = D.ml;
  el("advML").innerHTML = `<p class="sub" style="font-weight:600;color:var(--text)">ML model test (unseen data from ${fmtDate(ml.test_from)})</p>
    <table><tbody>${ml.models.map(m => `<tr><td>${m.name}${m.name === ml.chosen ? ' <span class="badge b-acc">used</span>' : ""}</td><td class="num">AUC ${nf(m.auc, 3)}</td><td class="num">acc ${pctu(m.accuracy, 0)}</td></tr>`).join("")}</tbody></table>
    <p class="note">AUC near 0.50 means a 20-day move is close to a coin toss, and the signals' hit rates sit within a few points of each other. That is the finding: use these screens to shortlist, then check the fundamentals.</p>`;
};
document.addEventListener("click", e => { const r = e.target.closest("tr[data-fund]"); if (r && state.page !== "funds") { state.fund = +r.dataset.fund; save(); location.hash = "funds"; } });

// ================================================================= MY PORTFOLIO
const PF_SAMPLE = [
  { t: "S", id: "RELIANCE", q: 25, p: 1320 }, { t: "S", id: "HDFCBANK", q: 40, p: 820 }, { t: "S", id: "INFY", q: 20, p: 1480 },
  { t: "S", id: "TCS", q: 6, p: 3300 }, { t: "S", id: "ITC", q: 120, p: 410 }, { t: "S", id: "SUNPHARMA", q: 15, p: 1650 },
  { t: "F", id: 122639, q: 900, p: 72 }, { t: "F", id: 118989, q: 250, p: 170 }, { t: "F", id: 119091, q: 4, p: 4900 },
];
const pfKey = h => h.t + ":" + h.id + (h.src ? "@" + h.src : "");
const pfName = h => h.t === "S" ? (STK[h.id] ? STK[h.id].name : h.id) : h.t === "F" ? (FUND[h.id] ? FUND[h.id].fund : "Fund " + h.id) : (h.name || h.id);
const pfReady = h => h.t === "S" ? !!STK[h.id] : h.t === "F" ? !!FUND[h.id] : true;
const pfCovered = h => h.t === "S" || h.t === "F";
const pfLast = h => h.t === "S" ? lastClose(h.id) : h.t === "F" ? FUND[h.id].nav : (h.ltp || h.p);
function pfPriceOn(h, i) {
  if (!pfCovered(h)) return null;
  if (h.t === "S") { const p = P(h.id); return at(h.id, "c", Math.max(i, p.s)); }
  const s = navSeries(h.id), k = bisectR(s.d, CAL[i]) - 1;
  return s.n[Math.max(0, k)];
}
function pfGroup(h) {
  if (h.t === "S") return STK[h.id].sector;
  if (h.t === "X") return "Other stocks";
  if (h.t === "M") return "MF · not matched";
  const f = FUND[h.id];
  return f.asset_class === "Equity" ? "MF · " + f.category : "MF · " + f.asset_class;
}
function pfAddHolding(h) {
  const cur = state.pf.find(x => pfKey(x) === pfKey(h));
  if (cur) { const q = cur.q + h.q; cur.p = (cur.p * cur.q + h.p * h.q) / q; cur.q = q; }
  else state.pf.push(h);
  save();
}

function setupPortfolioForm() {
  const type = el("pfType"), pick = el("pfPick"), qty = el("pfQty"), price = el("pfPrice"), msg = el("pfMsg");
  const fill = () => {
    const S = type.value === "S";
    el("pfList").innerHTML = S ? D.stocks.map(s => `<option value="${s.sym}">${esc(s.name)}</option>`).join("")
      : D.funds.map(f => `<option value="${esc(f.fund)}">${esc(f.category)} · AMFI ${f.scheme_code}</option>`).join("");
    pick.placeholder = S ? "e.g. RELIANCE or Infosys" : "e.g. Parag Parikh Flexi Cap Fund";
    el("pfQtyLabel").textContent = S ? "Quantity (shares)" : "Units held";
    el("pfPriceLabel").textContent = S ? "Avg buy price (₹)" : "Avg buy NAV (₹)";
  };
  const resolve = () => {
    const v = pick.value.trim().toLowerCase();
    if (!v) return null;
    if (type.value === "S") {
      const s = D.stocks.find(x => x.sym.toLowerCase() === v) || D.stocks.find(x => x.name.toLowerCase() === v)
        || D.stocks.find(x => x.sym.toLowerCase().startsWith(v) || x.name.toLowerCase().includes(v));
      return s ? { t: "S", id: s.sym } : null;
    }
    const f = D.funds.find(x => x.fund.toLowerCase() === v) || D.funds.find(x => x.fund.toLowerCase().includes(v));
    return f ? { t: "F", id: f.scheme_code } : null;
  };
  if (!type.dataset.ready) {
    type.dataset.ready = "1";
    type.onchange = () => { pick.value = ""; price.value = ""; fill(); };
    pick.onchange = () => { const r = resolve(); if (r) price.placeholder = "now " + nf(pfLast(r)); };
    el("pfAdd").onclick = () => {
      const r = resolve(), q = +qty.value, p = +price.value || (r ? pfLast(r) : 0);
      if (!r) { msg.textContent = type.value === "S" ? "Pick a stock from the list (NIFTY 50 stocks)." : "Fund not in the list: search it on the Fund Screener page first, then add it here."; return; }
      if (!(q > 0)) { msg.textContent = "Enter how many shares / units you hold."; return; }
      pfAddHolding({ ...r, q, p });
      msg.textContent = `Added ${pfName(r)}.`;
      pick.value = ""; qty.value = ""; price.value = ""; price.placeholder = "";
      RENDER.portfolio();
    };
    el("pfSample").onclick = () => { state.pf = PF_SAMPLE.map(x => ({ ...x })); save(); RENDER.portfolio(); };
    el("pfClear").onclick = () => { state.pf = []; save(); RENDER.portfolio(); };
    el("pfExport").onclick = () => {
      const blob = new Blob([JSON.stringify({ app: "BullScope", holdings: state.pf }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "bullscope-portfolio.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    el("pfImportBtn").onclick = () => el("pfImport").click();
    el("pfImport").onchange = async e => {
      try {
        const j = JSON.parse(await e.target.files[0].text());
        const list = (j.holdings || []).filter(h => (h.t === "S" || h.t === "F") && h.q > 0 && h.p >= 0);
        await Promise.allSettled(list.filter(h => h.t === "F").map(h => loadFund(+h.id)));
        state.pf = list.map(h => ({ t: h.t, id: h.t === "F" ? +h.id : String(h.id), q: +h.q, p: +h.p })); save();
        msg.textContent = `Imported ${state.pf.length} holdings.`;
      } catch (err) { msg.textContent = "That file is not a BullScope portfolio export."; }
      e.target.value = ""; RENDER.portfolio();
    };
  }
  fill();
}

RENDER.portfolio = function () {
  const t = T();
  setupPortfolioForm();
  setupDemat();
  state.pf = state.pf || [];
  const H = state.pf.filter(pfReady);
  el("pfEmpty").classList.toggle("hidden", H.length > 0);
  el("pfBody").classList.toggle("hidden", H.length === 0);
  if (!H.length) return;

  const rows = H.map(h => { const last = pfLast(h), value = h.q * last, inv = h.q * h.p; return { h, last, value, inv, pnl: value - inv, day: h.t === "S" ? dayChg(h.id) : null }; });
  const V = sum(rows.map(r => r.value)), INV = sum(rows.map(r => r.inv));
  rows.forEach(r => { r.w = r.value / V; });
  const covRows = rows.filter(r => pfCovered(r.h)), Vc = sum(covRows.map(r => r.value)), Vu = V - Vc;
  covRows.forEach(r => { r.wc = r.value / Vc; });
  const dayPnl = sum(rows.map(r => !pfCovered(r.h) ? 0 : r.h.t === "S" ? r.value * r.day / (1 + r.day) : (() => { const s = navSeries(r.h.id); const n = s.n.length; return n > 1 ? r.value * (1 - s.n[n - 2] / s.n[n - 1]) : 0; })()));

  // daily returns of the current mix over the last 2 years (fixed weights)
  const L = Math.min(756, N - 1), rp = [], nr = [];
  for (let i = N - L; i < N; i++) {
    let r = 0;
    covRows.forEach(x => { const a = pfPriceOn(x.h, i - 1), b = pfPriceOn(x.h, i); if (a && b) r += x.wc * (b / a - 1); });
    rp.push(r);
    const n0 = idxAt("NIFTY 50", i - 1), n1 = idxAt("NIFTY 50", i); nr.push(n1 / n0 - 1);
  }
  if (!covRows.length) rp.fill(0);
  const last1 = rp.slice(-252), nlast = nr.slice(-252);
  const mean = a => sum(a) / a.length, sdv = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const vol = sdv(last1) * Math.sqrt(252), annRet = Math.pow(last1.reduce((v, r) => v * (1 + r), 1), 252 / last1.length) - 1;
  const mp = mean(last1), mn = mean(nlast);
  const beta = sum(last1.map((x, i) => (x - mp) * (nlast[i] - mn))) / sum(nlast.map(x => (x - mn) ** 2));
  const sorted = [...last1].sort((a, b) => a - b), var95 = -sorted[Math.floor(0.05 * sorted.length)] * Vc;
  let pk = 1, cum = 1, mdd = 0; last1.forEach(r => { cum *= 1 + r; pk = Math.max(pk, cum); mdd = Math.min(mdd, cum / pk - 1); });
  const byInst = {};
  rows.forEach(r => { const k = r.h.t + ":" + r.h.id; byInst[k] = (byInst[k] || 0) + r.w; });  // same stock at two brokers counts once
  const effN = 1 / sum(Object.values(byInst).map(w => w * w));
  const groups = {}; rows.forEach(r => { const g = pfGroup(r.h); groups[g] = (groups[g] || 0) + r.w; });
  const divScore = Math.round(Math.min(100, Math.min(effN, 12) / 12 * 60 + Math.min(Object.keys(groups).length, 8) / 8 * 40));

  // Monte Carlo: bootstrap whole days of the portfolio return series
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const steps = 12, per = 21, cols = Array.from({ length: steps }, () => []);
  for (let p = 0; p < 3000; p++) { let v = Vc; for (let k = 1; k <= steps * per; k++) { v *= 1 + rp[Math.floor(rnd() * rp.length)]; if (k % per === 0) cols[k / per - 1].push(v + Vu); } }
  const qv = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
  const band = ["p5", "p25", "p50", "p75", "p95"].reduce((o, k, j) => (o[k] = cols.map(c => qv(c, [.05, .25, .5, .75, .95][j])), o), {});
  const fin = cols[steps - 1], probUp = fin.filter(v => v > V).length / fin.length;

  el("pfTiles").innerHTML = [
    tile("Current value", inrShort(V), `${H.length} holdings`),
    tile("Invested", inrShort(INV)),
    tile("Total profit / loss", `<span class="${cls(V - INV)}">${inrShort(V - INV)}</span>`, INV ? chg(V / INV - 1) : ""),
    tile("Last day", `<span class="${cls(dayPnl)}">${inrShort(dayPnl)}</span>`, chg(dayPnl / (V - dayPnl))),
    tile("1-year outlook (median)", `<span class="${cls(band.p50[steps - 1] - V)}">${inrShort(band.p50[steps - 1])}</span>`, `${pct(band.p50[steps - 1] / V - 1, 1)} · chance of gain ${pctu(probUp, 0)}`),
    tile("Diversification", `${divScore}/100`, divScore >= 70 ? "well spread" : divScore >= 45 ? "moderate" : "concentrated"),
  ].join("");

  const outlook = r => {
    if (!pfCovered(r.h)) return '<span class="badge b-neu">outside coverage</span><div class="mut" style="font-size:12px;margin-top:2px">valued at imported price</div>';
    if (r.h.t === "S") { const s = STK[r.h.id]; return `${sigBadge(s.signal)}<div class="mut" style="font-size:12px;margin-top:2px">60d median ${pct(s.mc.exp_return, 1)}</div>`; }
    const f = FUND[r.h.id]; return `${recBadge(f.recommendation)}<div class="mut" style="font-size:12px;margin-top:2px">1Y median ${pct(f.proj.exp_return, 1)}</div>`;
  };
  el("pfTable").innerHTML = `<table><thead><tr><th>Holding</th><th class="num">Qty / units</th><th class="num">Avg price</th><th class="num">Now</th><th class="num">Invested</th><th class="num">Value</th><th class="num">P&amp;L</th><th class="num">Weight</th><th>Signal / outlook</th><th></th></tr></thead><tbody>
    ${rows.sort((a, b) => b.value - a.value).map(r => `<tr><td class="name-cell"><b>${esc(pfName(r.h))}</b><span>${r.h.t === "S" ? r.h.id + " · " + STK[r.h.id].sector : r.h.t === "F" ? "Mutual fund · " + FUND[r.h.id].category : r.h.t === "X" ? r.h.id + " · stock" : "Mutual fund · not matched"}${r.h.src ? " · " + esc(r.h.src.replace(/^(file|api):/, "")) : ""}</span></td>
      <td class="num">${nf(r.h.q, r.h.t === "S" || r.h.t === "X" ? 0 : 3)}</td><td class="num">${nf(r.h.p)}</td><td class="num">${nf(r.last)}${r.day != null ? `<div style="font-size:12px">${chg(r.day)}</div>` : ""}</td>
      <td class="num">${inrShort(r.inv)}</td><td class="num"><b>${inrShort(r.value)}</b></td>
      <td class="num ${cls(r.pnl)}">${inrShort(r.pnl)}<div style="font-size:12px">${r.inv ? pct(r.pnl / r.inv, 1) : ""}</div></td>
      <td class="num">${pctu(r.w, 1)}</td><td>${outlook(r)}</td>
      <td><button type="button" class="btn sm" data-pf-del="${pfKey(r.h)}" aria-label="Remove">✕</button></td></tr>`).join("")}</tbody></table>`;
  el("pfTable").onclick = e => { const b = e.target.closest("[data-pf-del]"); if (b) { state.pf = state.pf.filter(x => pfKey(x) !== b.dataset.pfDel); save(); RENDER.portfolio(); } };

  // history of today's holdings over the selected period
  const [i0, i1] = rangeIdx(), dates = CAL.slice(i0, i1 + 1);
  const hv = dates.map((_, k) => Math.round(sum(rows.map(r => r.h.q * (pfPriceOn(r.h, i0 + k) || r.last)))));
  const n0 = idxAt("NIFTY 50", i0), nv = dates.map((_, k) => Math.round(hv[0] * idxAt("NIFTY 50", i0 + k) / n0));
  chart("pfHist", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4 },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].axisValue)}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${inrShort(x.value)}`).join("<br>")}` },
    xAxis: xCat(t, dates, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } }),
    yAxis: yVal(t, v => inrShort(v)),
    series: [{ name: "My holdings", type: "line", data: hv, showSymbol: false, lineStyle: { width: 2.4, color: t.s[0] }, itemStyle: { color: t.s[0] }, areaStyle: { color: alpha(t.s[0], 0.08) } },
      { name: "NIFTY 50 (same start)", type: "line", data: nv, showSymbol: false, lineStyle: { width: 1.6, color: t.muted }, itemStyle: { color: t.muted } }],
  }));

  const sv = sum(rows.filter(r => r.h.t === "S" || r.h.t === "X").map(r => r.w)), fv = 1 - sv;
  chart("pfMix", {
    tooltip: { backgroundColor: t.surface, borderColor: t.axis, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${p.name}: <b>${pctu(p.value / 100, 1)}</b>` },
    series: [{ type: "pie", radius: ["58%", "86%"], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: false },
      data: [{ name: "Stocks", value: +(sv * 100).toFixed(1), itemStyle: { color: t.s[0] } }, { name: "Mutual funds", value: +(fv * 100).toFixed(1), itemStyle: { color: t.s[1] } }].filter(x => x.value > 0) }],
    graphic: [{ type: "text", left: "center", top: "middle", style: { text: inrShort(V), fill: t.text, fontSize: 14, fontWeight: 600 } }],
  });
  el("pfMixLegend").innerHTML = `<span><i style="background:${t.s[0]}"></i>Stocks <b>${pctu(sv, 1)}</b></span><span><i style="background:${t.s[1]}"></i>Mutual funds <b>${pctu(fv, 1)}</b></span>`;

  el("pfPredTiles").innerHTML = [
    tile("Median in 1 year", inrShort(band.p50[steps - 1]), pct(band.p50[steps - 1] / V - 1, 1)),
    tile("Bad case (5%)", `<span class="down">${inrShort(band.p5[steps - 1])}</span>`, pct(band.p5[steps - 1] / V - 1, 1)),
    tile("Good case (95%)", `<span class="up">${inrShort(band.p95[steps - 1])}</span>`, pct(band.p95[steps - 1] / V - 1, 1)),
    tile("Chance of gain", pctu(probUp, 0)),
  ].join("");
  const months = ["Now", ...band.p50.map((_, k) => `M${k + 1}`)];
  const fan = (lo, hi, name, op) => [
    { name: name + "lo", type: "line", stack: name, data: [V, ...lo], lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
    { name, type: "line", stack: name, data: [0, ...hi.map((x, k) => x - lo[k])], lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: alpha(t.s[0], op) }, silent: true, tooltip: { show: false } }];
  chart("pfPred", base(t, {
    grid: { left: 8, right: 18, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => { const k = p[0].dataIndex; if (!k) return `Now: ${inrShort(V)}`; const q = k - 1; return `<b>Month ${k}</b><br>95%: ${inrShort(band.p95[q])}<br>75%: ${inrShort(band.p75[q])}<br>Median: <b>${inrShort(band.p50[q])}</b><br>25%: ${inrShort(band.p25[q])}<br>5%: ${inrShort(band.p5[q])}`; } },
    xAxis: xCat(t, months, { boundaryGap: false }), yAxis: yVal(t, v => inrShort(v)),
    series: [...fan(band.p5, band.p95, "5–95%", 0.12), ...fan(band.p25, band.p75, "25–75%", 0.22),
      { name: "Median", type: "line", data: [V, ...band.p50], showSymbol: false, lineStyle: { width: 2, color: t.s[0], type: [6, 4] }, itemStyle: { color: t.s[0] } },
      { name: "Today", type: "line", data: months.map(() => V), showSymbol: false, lineStyle: { width: 1, color: t.muted }, silent: true, tooltip: { show: false } }],
  }));

  const ge = Object.entries(groups).sort((a, b) => a[1] - b[1]);
  chart("pfSector", base(t, {
    tooltip: { ...base(t).tooltip, axisPointer: { type: "shadow" }, formatter: p => `${p[0].name}: <b>${pctu(p[0].value / 100, 1)}</b>` },
    grid: { left: 8, right: 50, top: 8, bottom: 8, containLabel: true },
    xAxis: yVal(t, v => v + "%", { scale: false }), yAxis: xCat(t, ge.map(g => g[0])),
    series: [{ type: "bar", barWidth: "60%", data: ge.map(g => +(g[1] * 100).toFixed(1)), itemStyle: { color: t.s[0], borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: p => p.value + "%" } }],
  }));
  el("pfRisk").innerHTML = [
    ["Volatility (ann.)", pctu(vol)], ["Return, last 12 months", pct(annRet, 1)], ["Beta vs NIFTY 50", nf(beta, 2)],
    ["Sharpe ratio", nf((annRet - D.meta.risk_free) / vol, 2)], ["Max drawdown (1Y)", pct(mdd, 1)], ["1-day value at risk (95%)", inrShort(var95)],
    ["Effective no. of holdings", nf(effN, 1)], ["Sectors / categories", Object.keys(groups).length],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  // suggestions
  const tips = [];
  const top = [...rows].sort((a, b) => b.w - a.w)[0];
  if (top.w > 0.25) tips.push(["warn", `<b>${esc(pfName(top.h))}</b> is ${pctu(top.w, 0)} of your portfolio. Keeping any one holding under 20–25% limits the damage if it falls.`]);
  const bigG = ge[ge.length - 1];
  if (bigG[1] > 0.4) tips.push(["warn", `<b>${esc(bigG[0])}</b> is ${pctu(bigG[1], 0)} of the portfolio. Spreading across more sectors lowers risk.`]);
  if (effN < 5) tips.push(["warn", `Your money behaves like only ${nf(effN, 1)} equal holdings. 8–15 holdings (or a couple of diversified funds) is a sturdier base.`]);
  if (beta > 1.15) tips.push(["warn", `Beta ${nf(beta, 2)}: the portfolio swings more than the market. Fine for long horizons; add a hybrid or debt fund to calm it.`]);
  rows.filter(r => r.h.t === "S" && STK[r.h.id].score <= -2).forEach(r => tips.push(["down", `<b>${r.h.id}</b> shows a <b>${STK[r.h.id].signal}</b> signal (score ${STK[r.h.id].score}). Check its news and fundamentals before adding more.`]));
  rows.filter(r => r.h.t === "F" && FUND[r.h.id].recommendation === "Review").forEach(r => {
    const f = FUND[r.h.id], alt = D.funds.filter(x => !x.external && x.category === f.category && x.scheme_code !== f.scheme_code).sort((a, b) => b.score - a.score)[0];
    tips.push(["down", `<b>${esc(f.fund)}</b> scores ${nf(f.score, 0)}/100 (Review).${alt && alt.score > (f.score || 0) + 15 ? ` A stronger ${esc(f.category)} option: <b>${esc(alt.fund)}</b> (${nf(alt.score, 0)}).` : ""}`]);
  });
  const unc = rows.filter(r => !pfCovered(r.h));
  if (unc.length) tips.push(["info", `${unc.length} holding${unc.length > 1 ? "s are" : " is"} outside BullScope's coverage (${unc.slice(0, 3).map(r => esc(pfName(r.h))).join(", ")}${unc.length > 3 ? "…" : ""}). They count at the imported price and are held flat in the prediction.`]);
  if (fv === 0) tips.push(["info", "You hold only stocks. A flexi-cap or index fund SIP adds instant diversification."]);
  if (!rows.some(r => r.h.t === "F" && ["Debt", "Hybrid"].includes(FUND[r.h.id].asset_class))) tips.push(["info", "No debt or hybrid fund: an emergency reserve in a liquid fund protects you from selling shares in a fall."]);
  rows.filter(r => r.h.t === "S" && STK[r.h.id].score >= 3).forEach(r => tips.push(["up", `<b>${r.h.id}</b> has a <b>Strong Buy</b> technical signal; its trend is healthy.`]));
  if (!tips.some(x => x[0] === "warn" || x[0] === "down")) tips.unshift(["up", "No red flags: the portfolio is reasonably spread and no holding shows a sell signal."]);
  const icon = { warn: '<span class="badge b-neu">!</span>', down: '<span class="badge b-down">▼</span>', up: '<span class="badge b-up">▲</span>', info: '<span class="badge b-acc">i</span>' };
  el("pfTips").innerHTML = `<ul class="checks" style="gap:10px">${tips.slice(0, 8).map(([k, x]) => `<li style="justify-content:flex-start;gap:10px;align-items:flex-start">${icon[k]}<span>${x}</span></li>`).join("")}</ul>`;
};

// ---------------------------------------------------------------- demat: file import + live sync through the local helper
const HELPER = "http://127.0.0.1:8766";
const DM_HOW = {
  zerodha: "Kite → Portfolio → Holdings → Download (CSV), or Console → Portfolio → Holdings → Download (XLSX, includes mutual funds).",
  groww: "Groww app/web → Profile → Reports → Stocks holdings statement and Mutual funds holdings statement (XLSX). Import each file.",
  upstox: "Upstox → Portfolio → Holdings → Download, or Reports → Holdings statement (XLSX/CSV).",
  angel: "Angel One → Portfolio → Holdings → Download, or Reports → Holdings statement (XLSX/CSV).",
  other: "Any holdings file with a name/symbol column, a quantity column and an average price (or invested value) column.",
};
const normH = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = v => { if (typeof v === "number") return v; const x = parseFloat(String(v == null ? "" : v).replace(/[₹,\s]/g, "")); return isNaN(x) ? null : x; };
const COLS = {
  name: ["instrument", "symbol", "trading symbol", "tradingsymbol", "stock name", "scrip name", "scrip", "company name", "security name", "stock", "scheme name", "fund name", "scheme", "security"],
  isin: ["isin", "isin code"],
  qty: ["qty", "quantity", "quantity available", "total quantity", "available quantity", "units", "balance units", "current units", "total units", "qty available"],
  avg: ["avg cost", "average price", "average buy price", "avg price", "buy avg", "average cost", "avg nav", "average nav", "purchase nav", "avg buy price", "buy average"],
  inv: ["invested value", "buy value", "investment value", "invested amount", "cost value", "invested", "total investment", "amount invested"],
  ltp: ["ltp", "closing price", "previous closing price", "current price", "market price", "last price", "nav", "current nav", "close price"],
  cur: ["current value", "cur val", "closing value", "market value", "present value", "value"],
};
function findCol(head, keys) { for (const k of keys) { const i = head.indexOf(k); if (i >= 0) return i; } for (const k of keys) { const i = head.findIndex(h => h.startsWith(k)); if (i >= 0) return i; } return -1; }
function parseTable(aoa) {
  const out = [];
  for (let r = 0; r < Math.min(aoa.length, 40); r++) {
    const head = (aoa[r] || []).map(normH);
    const c = Object.fromEntries(Object.entries(COLS).map(([k, keys]) => [k, findCol(head, keys)]));
    if (c.qty < 0 || (c.name < 0 && c.isin < 0)) continue;
    const mf = head.some(h => /scheme|fund name|folio|units/.test(h));
    for (let k = r + 1; k < aoa.length; k++) {
      const row = aoa[k] || [], name = c.name >= 0 ? String(row[c.name] || "").trim() : "", isin = c.isin >= 0 ? String(row[c.isin] || "").trim() : "";
      const qty = num(row[c.qty]);
      if (!name && !isin) { if (out.length) break; else continue; }
      if (!(qty > 0) || /^total/i.test(name)) continue;
      let avg = c.avg >= 0 ? num(row[c.avg]) : null, ltp = c.ltp >= 0 ? num(row[c.ltp]) : null;
      if (!avg && c.inv >= 0) avg = num(row[c.inv]) / qty;
      if (!ltp && c.cur >= 0) ltp = num(row[c.cur]) / qty;
      const isMf = mf || isin.startsWith("INF");
      out.push({ kind: isMf ? "mf" : "equity", symbol: isMf ? "" : name, name, isin, qty, avg: avg || ltp || 0, ltp: ltp || avg || 0, amfi_code: null });
    }
    if (out.length) break;
  }
  return out;
}
let xlsxReady = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return xlsxReady || (xlsxReady = new Promise((ok, bad) => {
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
  }));
}
async function readHoldingsFile(file) {
  await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.flatMap(n => parseTable(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" })));
}
const cleanSym = s => String(s || "").toUpperCase().replace(/\.(NS|BO)$/, "").replace(/-(EQ|BE|BZ|SM|ST)$/, "").trim();
const normName = s => normH(s).replace(/\b(limited|ltd|the|india|co|company|corporation|corp|inc)\b/g, " ").replace(/\s+/g, " ").trim();
const ALIAS = { TATAMOTORS: "TMPV", ZOMATO: "ETERNAL", "M M": "M&M", MM: "M&M", BAJAJAUTO: "BAJAJ-AUTO" };
function matchStock(r) {
  let sym = cleanSym(r.symbol || r.name); sym = ALIAS[sym] || sym;
  if (STK[sym]) return sym;
  const nn = normName(r.name);
  const hit = D.stocks.find(s => normName(s.name) === nn) || D.stocks.find(s => nn && (normName(s.name).startsWith(nn) || nn.startsWith(normName(s.name))));
  return hit ? hit.sym : null;
}
async function matchFund(r) {
  if (r.amfi_code) { try { await loadFund(+r.amfi_code); return +r.amfi_code; } catch (e) { /* fall back to name */ } }
  const words = normH(r.name).replace(/\b(direct|regular|plan|growth|option|fund|idcw|dividend)\b/g, " ").split(" ").filter(Boolean);
  const wantDirect = !/regular/i.test(r.name);
  const local = D.funds.find(f => words.length && words.every(w => normH(f.fund).includes(w)));
  if (local && wantDirect) return local.scheme_code;
  try {
    const res = await fetch(`${MFAPI}/search?q=${encodeURIComponent(words.slice(0, 4).join(" "))}`).then(x => x.json());
    const ok = res.filter(x => /growth/i.test(x.schemeName) && !/idcw|dividend|bonus/i.test(x.schemeName) && (/direct/i.test(x.schemeName) === wantDirect));
    const scored = ok.map(x => ({ x, s: words.filter(w => normH(x.schemeName).includes(w)).length / words.length })).sort((a, b) => b.s - a.s);
    if (scored.length && scored[0].s >= 0.75) { await loadFund(scored[0].x.schemeCode); return scored[0].x.schemeCode; }
  } catch (e) { /* offline: keep as unmatched */ }
  return null;
}
async function importHoldings(list, src, replace) {
  if (replace) state.pf = state.pf.filter(h => h.src !== src);
  let s = 0, f = 0, other = 0;
  for (const r of list) {
    if (r.kind === "mf") {
      const code = await matchFund(r);
      if (code) { pfAddHolding({ t: "F", id: code, q: r.qty, p: r.avg || FUND[code].nav, src }); f++; }
      else { pfAddHolding({ t: "M", id: r.isin || r.name, name: r.name, q: r.qty, p: r.avg, ltp: r.ltp, src }); other++; }
    } else {
      const sym = matchStock(r);
      if (sym) { pfAddHolding({ t: "S", id: sym, q: r.qty, p: r.avg || lastClose(sym), src }); s++; }
      else { pfAddHolding({ t: "X", id: cleanSym(r.symbol || r.name), name: r.name, q: r.qty, p: r.avg, ltp: r.ltp, src }); other++; }
    }
  }
  save();
  return { s, f, other };
}
async function helperStatus() {
  try { return await fetch(`${HELPER}/status`, { cache: "no-store" }).then(x => x.json()); } catch (e) { return null; }
}
async function renderHelper() {
  const st = await helperStatus(), badge = el("dmHelper");
  if (!st) {
    badge.className = "badge b-down"; badge.textContent = "helper not running";
    el("dmBrokers").innerHTML = '<p class="note" style="margin:0">Start <code>connector/bullscope_connector.py</code> on this PC, then click <b>Re-check helper</b>.</p>';
    return;
  }
  badge.className = "badge b-up"; badge.textContent = st.demo ? "helper running · demo" : "helper running";
  el("dmBrokers").innerHTML = Object.entries(st.brokers).map(([k, b]) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--grid);border-radius:8px;padding:8px 10px">
    <span><b>${b.name}</b> <span class="badge ${b.connected ? "b-up" : b.configured ? "b-neu" : "b-down"}">${b.connected ? "connected" : b.configured ? "not logged in" : "no API key"}</span></span>
    ${b.configured ? `<a class="btn sm" href="${HELPER}/login/${k}" target="_blank" rel="noopener">${b.connected ? "Log in again" : "Log in"}</a>` : '<span class="mut" style="font-size:12px">add key to connector/.env</span>'}</div>`).join("");
}
function setupDemat() {
  if (el("dmFileBtn").dataset.ready) return;
  el("dmFileBtn").dataset.ready = "1";
  const how = () => { el("dmHow").textContent = "Where to download: " + DM_HOW[el("dmBroker").value]; };
  el("dmBroker").onchange = how; how();
  el("dmFileBtn").onclick = () => el("dmFile").click();
  el("dmFile").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const msg = el("dmFileMsg"), broker = el("dmBroker").value;
    msg.textContent = `Reading ${file.name}…`;
    try {
      const rows = await readHoldingsFile(file);
      if (!rows.length) { msg.textContent = "No holdings table found in that file. Check it has name, quantity and average price columns."; return; }
      msg.textContent = `Found ${rows.length} holdings, matching them…`;
      const r = await importHoldings(rows, "file:" + broker, el("dmReplace").checked);
      msg.innerHTML = `Imported <b>${rows.length}</b> holdings: ${r.s} NIFTY 50 stocks, ${r.f} mutual funds with full analysis${r.other ? `, ${r.other} other (counted at the file's price)` : ""}.`;
    } catch (err) { msg.textContent = "Could not read that file (" + err.message + ")."; }
    e.target.value = ""; RENDER.portfolio();
  };
  el("dmRecheck").onclick = renderHelper;
  el("dmSync").onclick = async () => {
    const msg = el("dmSyncMsg");
    msg.textContent = "Fetching holdings from the helper…";
    try {
      const res = await fetch(`${HELPER}/holdings`, { cache: "no-store" }).then(x => x.json());
      if (!res.holdings.length) { msg.textContent = res.errors.length ? res.errors.join(" · ") : "No broker is logged in yet: click Log in first."; return; }
      const byBroker = {};
      res.holdings.forEach(h => { (byBroker[h.broker] = byBroker[h.broker] || []).push(h); });
      const parts = [];
      for (const [b, list] of Object.entries(byBroker)) { const r = await importHoldings(list, "api:" + b, true); parts.push(`${b}: ${list.length} (${r.s} stocks, ${r.f} funds${r.other ? `, ${r.other} other` : ""})`); }
      msg.innerHTML = `Synced ✓ ${parts.join(" · ")}${res.errors.length ? `<br><span class="down">${esc(res.errors.join(" · "))}</span>` : ""}`;
      RENDER.portfolio(); renderHelper();
    } catch (err) { msg.textContent = "The helper is not running on this PC (http://127.0.0.1:8766)."; }
  };
  renderHelper();
}

// ================================================================= ABOUT
RENDER.about = function () {
  const ml = D.ml, eq = D.funds.filter(f => f.asset_class === "Equity").length;
  el("aboutBody").innerHTML = `
    <p>BullScope is an analytics project on the Indian market. The same star-schema data feeds this web dashboard and the Power BI and Tableau kits in the repo. Prices are as of <b>${fmtDate(D.meta.as_of)}</b>.</p>
    <h3>Real data</h3>
    <table><thead><tr><th>Data</th><th>Source</th><th>Coverage</th></tr></thead><tbody>
      <tr><td>Daily OHLCV, 51 NIFTY 50 stocks (NSE)</td><td>Yahoo Finance (.NS)</td><td>${fmtDate(CAL[0])} – ${fmtDate(CAL[N - 1])}, ${N} sessions</td></tr>
      <tr><td>BSE closing prices</td><td>Yahoo Finance (.BO)</td><td>latest session</td></tr>
      <tr><td>11 indices incl. SENSEX, NIFTY BANK, sector indices, India VIX</td><td>Yahoo Finance</td><td>same period</td></tr>
      <tr><td>Fundamentals and promoter / institution split</td><td>Yahoo Finance</td><td>latest</td></tr>
      <tr><td>Mutual fund NAV, ${D.funds.length} direct-growth schemes</td><td>AMFI via api.mfapi.in</td><td>5 years daily; the <i>Fetch latest NAV</i> button calls it live</td></tr>
    </tbody></table>
    <h3>Modelled data (clearly labelled on each page)</h3>
    <ul>
      <li><b>Option chain</b>: premiums and Greeks are Black-Scholes prices from the real spot, with IV from India VIX (indices) or 30-day realised volatility (stocks) plus a skew. Open interest, change in OI and volume are modelled around the spot, with more OI at round strikes. NSE's live option-chain API blocks automated access, so it is not scraped.</li>
      <li><b>FII / DII flows</b>: daily figures driven by the real NIFTY 50 daily move (FIIs buy on up days; DIIs lean against FIIs and buy steadily).</li>
      <li><b>Fund holdings</b>: ${eq} equity-fund portfolios built from each fund's category (large/mid/small mix) and approximate AUM. Stakes are capped under SEBI's 10% per-company limit. Use the AMC's monthly factsheet for real holdings.</li>
    </ul>
    <h3>Data checks</h3>
    <p>Yahoo adjusts prices for splits and dividends but not demergers, so the Tata Motors demerger (14 Oct 2025) is adjusted in the build script. One-day moves above 25% that remain, worth checking against corporate-action filings:
      ${D.meta.jumps.map(j => `<code>${j.symbol} ${fmtDate(j.date)} ${pct(j.move, 1)}</code>`).join(" ")}</p>
    <h3>Method</h3>
    <ul>
      <li><b>Buy / sell split</b>: turnover × (1 + CLV) / 2, where CLV = ((close − low) − (high − close)) / (high − low). A close at the day's high counts as all buying, a close at the low as all selling.</li>
      <li><b>Technical score</b> (−5 to +5): price vs 50-DMA, 50-DMA vs 200-DMA, MACD histogram, RSI below 30 / above 70, 3-month momentum ±5%.</li>
      <li><b>ML</b>: ${ml.models.map(m => m.name).join(" and ")} on 10 technical features, trained on data before ${fmtDate(ml.test_from)} with a 20-session gap, then tested on later data. Best test AUC ${Math.max(...ml.models.map(m => m.auc))}.</li>
      <li><b>Monte Carlo</b>: 3,000 paths built by resampling real daily log returns (1 year for stocks, 3 years for funds).</li>
      <li><b>Fund score</b>: percentile rank within equity (or debt) funds: 3Y CAGR 30%, Sharpe 25%, max drawdown 15%, Sortino 10%, share of positive rolling 1-year windows 10%, 1Y return 10%. ≥75 Strong Buy, 55–75 Buy, 40–55 Hold, &lt;40 Review.</li>
      <li><b>SIP XIRR</b>: monthly instalments on the first NAV date of each month, solved by bisection.</li>
      <li><b>Max pain</b>: the strike where option buyers' total payoff at expiry is smallest.</li>
    </ul>
    <h3>Live data on this page</h3>
    <ul>
      <li><b>News</b>: headlines from 90+ publishers (Economic Times, Mint, Business Standard, CNBC TV18, CoinDesk, Cointelegraph, Decrypt and more via Google News) and market videos from CNBC-TV18, CNBC Awaaz, Moneycontrol, NDTV Profit, Business Today, CoinDesk and Coin Bureau. Each story is tagged with the NIFTY 50 companies and coins it names; tone (positive / negative / neutral) comes from a word list and can be wrong. Live every 5 minutes when opened with <code>serve.py</code>; otherwise the snapshot in <code>docs/news.json</code>.</li>
      <li><b>Crypto</b>: prices, market caps, dominance and charts from CoinGecko, refreshed every minute; Fear &amp; Greed from alternative.me.</li>
      <li><b>Any mutual fund</b>: searching a scheme outside the screener downloads its full NAV history from AMFI (via mfapi.in) and computes the same returns, risk and score in your browser.</li>
    </ul>
    <h3>Your data</h3>
    <ul>
      <li><b>My Portfolio, watchlists, price alerts and saved news</b> are stored only in this browser (local storage). Nothing is uploaded. Export / Import moves a portfolio between browsers.</li>
      <li><b>Demat import</b> reads your broker's holdings file inside the browser. <b>Live sync</b> uses the optional <code>connector/</code> helper on your own PC with the broker's official API; you log in on the broker's site and tokens stay in the helper's memory.</li>
      <li><b>Portfolio prediction</b>: 3,000 paths that replay whole real days from the last 3 years, so holdings keep the correlations they really had. Holdings outside BullScope's coverage are held flat.</li>
      <li><b>Goal planner</b>: monthly SIP needed = (inflated target − future value of savings) ÷ annuity factor at the model portfolio's blended return; the chance of success comes from a Monte Carlo with the blended volatility.</li>
    </ul>
    <h3>Refresh</h3>
    <p>A GitHub Actions workflow runs <code>scripts/fetch_data.py</code> and <code>scripts/build_dataset.py</code> every weekday at 18:30 IST and commits the new <code>docs/data.js</code>.</p>
    <p class="disclaimer">Educational project, not investment advice. Not affiliated with NSE, BSE, AMFI or any AMC.</p>`;
};

// ================================================================= EXTRAS: watchlist, seasonality, 52-week, compare, goal planner
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const high52 = sym => { const c = P(sym).c.slice(-252); return { hi: Math.max(...c), lo: Math.min(...c) }; };

let renderWatch = function () {
  const box = el("ovWatch"), W = state.watch.filter(w => STK[w.sym]);
  if (!W.length) { box.innerHTML = '<p class="note">Your watchlist is empty. Open any stock in the Stock Explorer and click <b>☆ Watch</b>.</p>'; return; }
  const [i0, i1] = rangeIdx();
  box.innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Price</th><th class="num">Day</th><th class="num">Period</th><th>Signal</th><th class="num">vs 52-wk high</th><th class="num">Alert above ₹</th><th class="num">Alert below ₹</th><th>Alert</th><th></th></tr></thead><tbody>
    ${W.map(w => {
      const s = STK[w.sym], px = lastClose(w.sym), { hi } = high52(w.sym);
      const up = w.above > 0 && px >= w.above, dn = w.below > 0 && px <= w.below;
      const status = up ? `<span class="badge b-up">▲ above ${nf(w.above)}</span>` : dn ? `<span class="badge b-down">▼ below ${nf(w.below)}</span>`
        : (w.above || w.below) ? '<span class="badge b-neu">waiting</span>' : '<span class="mut">set a price</span>';
      return `<tr ${up || dn ? 'class="sel"' : ""}><td class="name-cell"><a href="#stocks" data-open="${w.sym}" style="text-decoration:none;color:inherit"><b>${w.sym}</b><span>${esc(s.name)}</span></a></td>
        <td class="num">${nf(px)}</td><td class="num">${chg(dayChg(w.sym))}</td><td class="num">${chg(stockRet(w.sym, i0, i1), 1)}</td><td>${sigBadge(s.signal)}</td>
        <td class="num">${pct(px / hi - 1, 1)}</td>
        <td class="num"><input class="text-in" type="number" step="any" min="0" style="width:96px" data-w="${w.sym}" data-f="above" value="${w.above || ""}" placeholder="${nf(px * 1.05, 0)}"></td>
        <td class="num"><input class="text-in" type="number" step="any" min="0" style="width:96px" data-w="${w.sym}" data-f="below" value="${w.below || ""}" placeholder="${nf(px * 0.95, 0)}"></td>
        <td>${status}</td><td><button type="button" class="btn sm" data-unwatch="${w.sym}" aria-label="Remove from watchlist">✕</button></td></tr>`;
    }).join("")}</tbody></table>`;
  box.onchange = e => { const x = e.target; if (!x.dataset.w) return; const w = state.watch.find(v => v.sym === x.dataset.w); w[x.dataset.f] = +x.value || 0; save(); renderWatch(); };
  box.onclick = e => {
    const b = e.target.closest("[data-unwatch]"); if (b) { state.watch = state.watch.filter(v => v.sym !== b.dataset.unwatch); save(); renderWatch(); return; }
    const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openStock(a.dataset.open); }
  };
};

function renderSeason(t) {
  const name = state.ovIdx, s = D.indices[name], monthEnd = new Map();
  let base = null;
  CAL.forEach((d, i) => { if (s[i] == null) return; if (base == null) base = s[i]; monthEnd.set(d.slice(0, 7), s[i]); });
  const keys = [...monthEnd.keys()], years = [...new Set(keys.map(k => k.slice(0, 4)))];
  const data = [], byM = Array.from({ length: 12 }, () => []);
  keys.forEach((k, j) => {
    const prev = j ? monthEnd.get(keys[j - 1]) : base, r = monthEnd.get(k) / prev - 1, m = +k.slice(5) - 1, y = years.indexOf(k.slice(0, 4));
    data.push([m, y, r]); byM[m].push(r);
  });
  const avgY = years.length;
  byM.forEach((a, m) => { if (a.length) data.push([m, avgY, sum(a) / a.length]); });
  const lim = Math.max(0.03, ...data.map(d => Math.abs(d[2]))) * 0.8;
  el("ovSeasonTitle").textContent = `Seasonality · ${name}`;
  chart("ovSeason", {
    textStyle: { fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif" },
    tooltip: { backgroundColor: t.surface, borderColor: t.axis, textStyle: { color: t.text, fontSize: 12 },
      formatter: p => `${MONTHS[p.value[0]]} ${p.value[1] === avgY ? "· average of all years" : years[p.value[1]]}<br><b>${pct(p.value[2], 2)}</b>` },
    grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: MONTHS, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted }, splitArea: { show: false } },
    yAxis: { type: "category", data: [...years, "Average"], inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.text2, fontWeight: 600 } },
    series: [{ type: "heatmap", data: data.map(d => ({ value: d, itemStyle: { color: divColor(t, d[2], lim), borderColor: t.surface, borderWidth: d[1] === avgY ? 3 : 2, borderRadius: 4 } })),
      label: { show: true, color: t.text, fontSize: 11, formatter: p => pct(p.value[2], 1) } }],
  });
}

function render52() {
  seg("ov52Seg", ["Near high", "Near low"], state.ov52, v => { state.ov52 = v; save(); render52(); });
  const hiMode = state.ov52 === "Near high";
  const list = D.stocks.map(s => { const px = lastClose(s.sym), { hi, lo } = high52(s.sym); return { s, px, dh: px / hi - 1, dl: px / lo - 1 }; })
    .sort((a, b) => hiMode ? b.dh - a.dh : a.dl - b.dl).slice(0, 8);
  el("ov52").innerHTML = `<table><thead><tr><th>Stock</th><th class="num">Price</th><th class="num">${hiMode ? "From high" : "Above low"}</th></tr></thead><tbody>${list.map(x =>
    `<tr class="click" data-sym="${x.s.sym}"><td class="name-cell"><b>${x.s.sym}</b><span>${esc(x.s.name)}</span></td><td class="num">${nf(x.px)}</td><td class="num">${hiMode ? (x.dh > -0.0005 ? '<span class="badge b-up">at 52-wk high</span>' : pct(x.dh, 1)) : (x.dl < 0.0005 ? '<span class="badge b-down">at 52-wk low</span>' : pct(x.dl, 1))}</td></tr>`).join("")}</tbody></table>`;
}

const _overview = RENDER.overview;
RENDER.overview = function () { _overview(); const t = T(); renderWatch(); renderSeason(t); render52(); };

const _stocks = RENDER.stocks;
RENDER.stocks = function () {
  _stocks();
  const sym = state.stock, on = state.watch.some(w => w.sym === sym);
  el("stWatch").textContent = on ? "★ Watching" : "☆ Watch";
  el("stWatch").classList.toggle("primary", on);
  el("stWatch").onclick = () => { state.watch = on ? state.watch.filter(w => w.sym !== sym) : [...state.watch, { sym, above: 0, below: 0 }]; save(); RENDER.stocks(); };
  el("stCompare").onclick = () => { cmpAdd("S:" + sym); location.hash = "compare"; };
};

const _funds = RENDER.funds;
RENDER.funds = function () {
  _funds();
  const n = D.funds.filter(f => !f.external).length, ext = D.funds.length - n;
  el("mfIntro").textContent = `${n} popular direct-growth schemes with real AMFI NAV history${ext ? `, plus ${ext} you searched` : ""}. Returns, risk, SIP results, a 1-year projection and a score for each fund. Search to analyse any other fund.`;
};

// ---------------------------------------------------------------- compare
function cmpLabel(key) {
  const [k, id] = [key[0], key.slice(2)];
  if (k === "S") return STK[id] ? id : null;
  if (k === "I") return D.indices[id] ? id : null;
  return FUND[+id] ? FUND[+id].fund.replace(/ Fund$/, "") : null;
}
function cmpAdd(key) {
  if (state.cmpItems.some(x => x.key === key)) return;
  if (state.cmpItems.length >= 5) state.cmpItems.shift();
  const used = new Set(state.cmpItems.map(x => x.c));
  state.cmpItems.push({ key, c: [0, 1, 2, 3, 4].find(c => !used.has(c)) });  // colour follows the item, not its position
  save();
}
function cmpValue(key, i) {
  const k = key[0], id = key.slice(2);
  if (k === "S") { const p = P(id); return i < p.s ? null : at(id, "c", i); }
  if (k === "I") return D.indices[id][i];
  const s = navSeries(+id), j = bisectR(s.d, CAL[i]) - 1;
  return j < 0 ? null : s.n[j];
}
RENDER.compare = function () {
  const t = T(), [i0, i1] = rangeIdx(), items = state.cmpItems.filter(x => cmpLabel(x.key));
  const opts = [["Indices", Object.keys(D.indices).filter(n => n !== "INDIA VIX").map(n => ["I:" + n, n])],
    ["Stocks", D.stocks.map(s => ["S:" + s.sym, `${s.sym} · ${s.name}`])],
    ["Mutual funds", D.funds.map(f => ["F:" + f.scheme_code, f.fund])]];
  el("cmpAdd").innerHTML = `<option value="">+ Add stock, index or fund</option>` + opts.map(([g, list]) => `<optgroup label="${g}">${list.filter(([v]) => !items.some(x => x.key === v)).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</optgroup>`).join("");
  el("cmpAdd").onchange = e => { if (e.target.value) { cmpAdd(e.target.value); RENDER.compare(); } };
  el("cmpChips").innerHTML = items.map(x => `<button type="button" class="chip" data-rm="${esc(x.key)}"><span style="color:${t.s[x.c]}">●</span> ${esc(cmpLabel(x.key))} ✕</button>`).join("") || '<span class="mut">Add something to compare</span>';
  el("cmpChips").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { state.cmpItems = state.cmpItems.filter(x => x.key !== b.dataset.rm); save(); RENDER.compare(); } };

  const dates = CAL.slice(i0, i1 + 1);
  const S = items.map(x => {
    const raw = dates.map((_, k) => cmpValue(x.key, i0 + k));
    for (let k = 1; k < raw.length; k++) if (raw[k] == null && raw[k - 1] != null) raw[k] = raw[k - 1];
    const first = raw.find(v => v != null), idx = raw.map(v => v == null ? null : +(v / first * 100).toFixed(2));
    const ret = raw.map((v, k) => k && v != null && raw[k - 1] != null ? v / raw[k - 1] - 1 : null);
    let pk = 0; const dd = raw.map(v => { if (v == null) return null; pk = Math.max(pk, v); return +((v / pk - 1) * 100).toFixed(2); });
    return { ...x, name: cmpLabel(x.key), color: t.s[x.c], raw, idx, ret, dd };
  });
  const line = (data, key) => S.map(s => ({ name: s.name, type: "line", data: s[key], showSymbol: false, connectNulls: true, lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color } }));
  const xax = xCat(t, dates, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } });
  chart("cmpGrowth", base(t, {
    legend: { top: 0, left: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4, type: "scroll" },
    grid: { left: 8, right: 18, top: 34, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].axisValue)}</b><br>${p.filter(x => x.value != null).sort((a, b) => b.value - a.value).map(x => `${x.marker}${esc(x.seriesName)}: <b>${nf(x.value)}</b> (${pct(x.value / 100 - 1, 1)})`).join("<br>")}` },
    xAxis: xax, yAxis: yVal(t, v => v), series: line(S, "idx"),
  }));
  chart("cmpDD", base(t, {
    legend: { top: 0, left: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4, type: "scroll" },
    grid: { left: 8, right: 18, top: 34, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].axisValue)}</b><br>${p.filter(x => x.value != null).map(x => `${x.marker}${esc(x.seriesName)}: ${nf(x.value, 1)}%`).join("<br>")}` },
    xAxis: xax, yAxis: yVal(t, v => v + "%", { scale: false, max: 0 }), series: line(S, "dd"),
  }));

  const corr = (a, b) => {
    const xs = [], ys = [];
    a.forEach((v, k) => { if (v != null && b[k] != null) { xs.push(v); ys.push(b[k]); } });
    if (xs.length < 10) return null;
    const mx = sum(xs) / xs.length, my = sum(ys) / ys.length;
    const cv = sum(xs.map((x, k) => (x - mx) * (ys[k] - my))), vx = Math.sqrt(sum(xs.map(x => (x - mx) ** 2))), vy = Math.sqrt(sum(ys.map(y => (y - my) ** 2)));
    return cv / (vx * vy);
  };
  const cells = [];
  S.forEach((a, i) => S.forEach((b, j) => { const c = i === j ? 1 : corr(a.ret, b.ret); if (c != null) cells.push({ value: [j, i, +c.toFixed(2)], itemStyle: { color: c >= 0 ? mix(t.neutral, t.s[0], c) : mix(t.neutral, t.s[7], -c), borderColor: t.surface, borderWidth: 3, borderRadius: 4 } }); }));
  chart("cmpCorr", {
    tooltip: { backgroundColor: t.surface, borderColor: t.axis, textStyle: { color: t.text, fontSize: 12 }, formatter: p => `${esc(S[p.value[1]].name)} vs ${esc(S[p.value[0]].name)}<br>Correlation <b>${p.value[2]}</b>` },
    grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "category", data: S.map(s => s.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 10, interval: 0, rotate: 30, width: 90, overflow: "truncate" } },
    yAxis: { type: "category", data: S.map(s => s.name), inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 10, width: 90, overflow: "truncate" } },
    series: [{ type: "heatmap", data: cells, label: { show: true, color: t.text, fontSize: 12, fontWeight: 600 } }],
  });

  const nret = dates.map((d, k) => k ? idxAt("NIFTY 50", i0 + k) / idxAt("NIFTY 50", i0 + k - 1) - 1 : null);
  const days = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 864e5;
  el("cmpTable").innerHTML = `<table><thead><tr><th>Item</th><th class="num">Start</th><th class="num">End</th><th class="num">Return</th><th class="num">CAGR</th><th class="num">Volatility</th><th class="num">Max drawdown</th><th class="num">Sharpe</th><th class="num">Beta vs NIFTY</th><th class="num">Best day</th><th class="num">Worst day</th></tr></thead><tbody>
    ${S.map(s => {
      const v = s.raw.filter(x => x != null), r = s.ret.filter(x => x != null), tot = v[v.length - 1] / v[0] - 1;
      const cagr = days >= 365 ? Math.pow(1 + tot, 365 / days) - 1 : null, m = sum(r) / r.length;
      const vol = Math.sqrt(sum(r.map(x => (x - m) ** 2)) / r.length) * Math.sqrt(252);
      const annual = cagr != null ? cagr : m * 252;
      const pairs = s.ret.map((x, k) => [x, nret[k]]).filter(p => p[0] != null && p[1] != null);
      const mx = sum(pairs.map(p => p[0])) / pairs.length, my = sum(pairs.map(p => p[1])) / pairs.length;
      const beta = sum(pairs.map(p => (p[0] - mx) * (p[1] - my))) / sum(pairs.map(p => (p[1] - my) ** 2));
      return `<tr><td><span style="color:${s.color}">●</span> <b>${esc(s.name)}</b></td><td class="num">${nf(v[0])}</td><td class="num">${nf(v[v.length - 1])}</td>
        <td class="num">${chg(tot, 1)}</td><td class="num">${cagr == null ? '<span class="mut">&lt; 1 yr</span>' : chg(cagr, 1)}</td><td class="num">${pctu(vol)}</td>
        <td class="num down">${pct(Math.min(...s.dd.filter(x => x != null)) / 100, 1)}</td><td class="num">${nf((annual - D.meta.risk_free) / vol, 2)}</td>
        <td class="num">${nf(beta, 2)}</td><td class="num up">${pct(Math.max(...r), 1)}</td><td class="num down">${pct(Math.min(...r), 1)}</td></tr>`;
    }).join("")}</tbody></table>`;
};

// ---------------------------------------------------------------- goal planner
function goalSim(sip, lump, years, mu, sigma, n = 1500) {
  const m = years * 12, dm = Math.log(1 + mu) / 12 - sigma * sigma / 24, sm = sigma / Math.sqrt(12);
  let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const yearly = Array.from({ length: years + 1 }, () => []);
  for (let p = 0; p < n; p++) {
    let v = lump; yearly[0].push(v);
    for (let k = 1; k <= m; k++) { v = (v + sip) * Math.exp(dm + sm * gauss()); if (k % 12 === 0) yearly[k / 12].push(v); }
  }
  return yearly;
}
const _advisor = RENDER.advisor;
RENDER.advisor = function () {
  _advisor();
  const t = T();
  const qs = ["qAge", "qHor", "qFall"].map(id => +el(id).value), auto = sum(qs) <= 3 ? "Conservative" : sum(qs) <= 6 ? "Moderate" : "Aggressive";
  const prof = state.profile || auto, P_ = D.portfolios[prof];
  const mu = P_.blended_cagr3y, sigma = sum(P_.items.map(x => x.weight / 100 * FUND[x.scheme_code].volatility));
  ["goalName", "goalAmt", "goalYears", "goalHave", "goalInfl"].forEach(id => { el(id).oninput = () => RENDER.advisor(); });
  const amt = Math.max(10000, +el("goalAmt").value || 0), yrs = Math.min(40, Math.max(1, Math.round(+el("goalYears").value || 10)));
  const have = Math.max(0, +el("goalHave").value || 0), infl = Math.max(0, +el("goalInfl").value || 0) / 100;
  const target = amt * Math.pow(1 + infl, yrs), rm = Math.pow(1 + mu, 1 / 12) - 1, n = yrs * 12;
  const fvLump = have * Math.pow(1 + mu, yrs), factor = (Math.pow(1 + rm, n) - 1) / rm * (1 + rm);
  const sip = Math.max(0, Math.ceil((target - fvLump) / factor / 100) * 100);
  const chance = s => { const y = goalSim(s, have, yrs, mu, sigma)[yrs]; return y.filter(v => v >= target).length / y.length; };
  const pBase = chance(sip);
  let sip80 = sip; for (let k = 0; k < 40 && chance(sip80) < 0.8; k++) sip80 = Math.ceil(sip80 * 1.06 / 100) * 100 + 100;
  const sim = goalSim(sip, have, yrs, mu, sigma), q = (a, x) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(x * (s.length - 1))]; };
  el("goalTiles").innerHTML = [
    tile(`${esc(el("goalName").value)} target in ${yrs} yrs`, inrShort(target), infl ? `${inrShort(amt)} today + ${pctu(infl, 1)} inflation` : "no inflation"),
    tile("Monthly SIP needed", `<span class="up">${inrShort(sip)}</span>`, `${prof} mix · ${pctu(mu, 1)} expected return`),
    tile("Chance of reaching it", pctu(pBase, 0), "with that SIP (median-return plan)"),
    tile("SIP for an 80% chance", inrShort(sip80), "a safer plan"),
    tile("Total you invest", inrShort(have + sip * n), `${inrShort(sip)} × ${n} months${have ? " + savings" : ""}`),
  ].join("");
  const yl = sim.map((_, k) => `Year ${k}`);
  chart("goalChart", base(t, {
    legend: { top: 0, right: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4, data: ["Median path", "Target"] },
    grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: p => { const k = p[0].dataIndex; return `<b>Year ${k}</b><br>90%: ${inrShort(q(sim[k], .9))}<br>Median: <b>${inrShort(q(sim[k], .5))}</b><br>10%: ${inrShort(q(sim[k], .1))}<br>Target: ${inrShort(target)}`; } },
    xAxis: xCat(t, yl, { boundaryGap: false }), yAxis: yVal(t, v => inrShort(v), { scale: false }),
    series: [{ name: "lo", type: "line", stack: "g", data: sim.map(a => q(a, .1)), lineStyle: { opacity: 0 }, showSymbol: false, silent: true },
      { name: "10–90%", type: "line", stack: "g", data: sim.map(a => q(a, .9) - q(a, .1)), lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: alpha(t.s[0], 0.14) }, silent: true },
      { name: "Median path", type: "line", data: sim.map(a => Math.round(q(a, .5))), showSymbol: false, lineStyle: { width: 2.4, color: t.s[0] }, itemStyle: { color: t.s[0] } },
      { name: "Target", type: "line", data: sim.map(() => Math.round(target)), showSymbol: false, lineStyle: { width: 1.6, color: t.s[1] }, itemStyle: { color: t.s[1] } }],
  }));
};

// ---------------------------------------------------------------- market pulse hero + tile sparklines
function sparkSVG(vals, color, w = 84, h = 30, fill = true) {
  const v = vals.filter(x => x != null), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, k) => `${(k / (v.length - 1) * w).toFixed(1)},${(h - 2 - (x - lo) / span * (h - 4)).toFixed(1)}`).join(" ");
  const id = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${fill ? `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${id})"/>` : ""}
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function renderHero() {
  const box = el("ovHero"), i1 = N - 1, n = D.indices["NIFTY 50"];
  const last = idxAt("NIFTY 50", i1), d1 = last / idxAt("NIFTY 50", i1 - 1) - 1;
  const [r0] = rangeIdx(), pr = idxRet("NIFTY 50", r0, i1);
  const hist = n.slice(-90).filter(x => x != null);
  const sma50 = sum(n.slice(-50).filter(x => x != null)) / n.slice(-50).filter(x => x != null).length;
  const moves = D.stocks.map(s => dayChg(s.sym)), up = moves.filter(x => x > 0).length, dn = moves.filter(x => x < 0).length, flat = moves.length - up - dn;
  const breadth = up / moves.length, trendUp = last > sma50;
  const mood = breadth >= 0.6 && trendUp ? ["Bullish", ic("up", 22)] : breadth <= 0.4 && !trendUp ? ["Bearish", ic("down", 22)] : breadth >= 0.5 ? ["Cautiously positive", ic("up", 22)] : ["Cautious", ic("flat", 22)];
  const vix = idxAt("INDIA VIX", i1), vpos = Math.max(0, Math.min(100, (vix - 10) / 20 * 100));
  const vlabel = vix < 13 ? "Calm" : vix < 18 ? "Normal" : vix < 24 ? "Nervous" : "Fearful";
  box.innerHTML = `
    <div><div class="eyebrow">NIFTY 50 · ${fmtDate(CAL[i1])} close</div>
      <div class="big">${nf(last)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="delta">${d1 >= 0 ? "▲" : "▼"} ${pct(d1)} today</span><span class="delta">${pr >= 0 ? "▲" : "▼"} ${pct(pr, 1)} in period</span></div>
      ${sparkSVG(hist, "#ffffff", 300, 46, true).replace('class="spark"', 'class="heroline"')}</div>
    <div><div class="eyebrow">Market mood</div><div class="mood mood-row">${mood[1]}<span>${mood[0]}</span></div>
      <div class="sub2">${up} of ${moves.length} NIFTY 50 stocks rose today · index ${trendUp ? "above" : "below"} its 50-day average (${nf(sma50, 0)})</div>
      <div class="bar"><i style="flex:${up};background:#34d399"></i><i style="flex:${flat || 0.0001};background:rgba(255,255,255,.4)"></i><i style="flex:${dn};background:#f87171"></i></div>
      <div class="legend2"><span>${up} up</span><span>${dn} down</span></div></div>
    <div><div class="eyebrow">Fear gauge · India VIX</div><div class="mood">${nf(vix)} <span style="font-size:14px;font-weight:600;opacity:.85">${vlabel}</span></div>
      <div class="sub2">Expected NIFTY swing ≈ ±${nf(vix / Math.sqrt(12), 1)}% over the next month</div>
      <div class="gauge"><b style="left:${vpos}%"></b></div>
      <div class="legend2"><span>Calm 10</span><span>20</span><span>30 Fear</span></div></div>`;
}
const _overview2 = RENDER.overview;
RENDER.overview = function () {
  _overview2();
  renderHero();
  const t = T();
  document.querySelectorAll("#ovTiles .tile[data-idx]").forEach(tl => {
    const name = tl.dataset.idx, s = D.indices[name].slice(-40);
    const col = name === "INDIA VIX" ? t.s[6] : (s[s.length - 1] >= s.find(x => x != null) ? t.up : t.down);
    tl.insertAdjacentHTML("beforeend", sparkSVG(s, col));
  });
};

// ---------------------------------------------------------------- line icons (replace emoji so the UI reads as one system)
const ICONS = {
  up: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  flat: '<path d="M3 12h4l3-4 4 8 3-4h4"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  building: '<path d="M4 21V5l8-3v19M12 8l8 3v10M8 7v.01M8 11v.01M8 15v.01M16 13v.01M16 17v.01M2 21h20"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8h3.5a2 2 0 0 1 0 4H9.5zM9.5 12h4a2 2 0 0 1 0 4h-4zM9.5 8v8M11 6.5V8M11 16v1.5"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3"/>',
  landmark: '<path d="M3 21h18M4 10h16M12 3l9 7H3zM6 10v8M10 10v8M14 10v8M18 10v8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  play: '<polygon points="8 5 19 12 8 19" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  page: '<path d="M7 17L17 7M9 7h8v8"/>',
};
const ic = (name, size = 18, cls = "ico") => `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ================================================================= NEWS (live via serve.py, else docs/news.json)
const NEWS = { data: null, live: false, shown: 30, at: 0 };
const timeAgo = iso => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
async function loadNews() {
  try {
    const r = await fetch("api/news", { cache: "no-store" });
    if (r.ok) { NEWS.data = await r.json(); NEWS.live = true; NEWS.at = Date.now(); return; }
  } catch (e) { /* not running under serve.py */ }
  try { NEWS.data = await fetch("news.json?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()); NEWS.live = false; NEWS.at = Date.now(); }
  catch (e) { NEWS.data = NEWS.data || { items: [], fetched: null, sources: [] }; }
}
const toneBadge = t => t === "Positive" ? '<span class="badge b-up">▲ Positive</span>' : t === "Negative" ? '<span class="badge b-down">▼ Negative</span>' : '<span class="badge b-neu">■ Neutral</span>';
let newsCard = function (n, compact) {
  const tagsHtml = [...n.stocks.map(s => `<span class="badge b-acc" data-ntag="${s}">${s}</span>`), ...n.coins.map(c => `<span class="badge b-acc" data-ntag="${c}">${c}</span>`)].join(" ");
  if (compact) return `<a class="news-row" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><b>${esc(n.title)}</b><span>${esc(n.source)} · ${timeAgo(n.published)}</span></a>`;
  return `<article class="news-card">
    ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div><div class="news-meta"><span class="badge b-neu">${esc(n.category)}</span>${toneBadge(n.tone)}<span class="mut">${esc(n.source)} · ${timeAgo(n.published)}</span></div>
    <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    ${n.summary ? `<p class="news-sum">${esc(n.summary)}</p>` : ""}${tagsHtml ? `<div class="news-tags">${tagsHtml}</div>` : ""}</div></article>`;
};
function newsStatus(id) {
  const b = el(id); if (!b || !NEWS.data) return;
  b.className = "badge " + (NEWS.live ? "b-up" : "b-neu");
  b.textContent = NEWS.live ? `● Live · ${NEWS.data.items.length} stories` : NEWS.data.fetched ? `Snapshot · ${timeAgo(NEWS.data.fetched)}` : "No news available";
}
RENDER.news = function () {
  if (!NEWS.data) { loadNews().then(() => state.page === "news" && RENDER.news()); return; }
  const t = T(), items = NEWS.data.items;
  newsStatus("newsStatus");
  el("newsRefresh").onclick = async () => { el("newsRefresh").textContent = "Refreshing…"; await loadNews(); el("newsRefresh").textContent = "↻ Refresh"; RENDER.news(); };
  const cats = ["All", "Markets", "Stocks", "Mutual funds", "Economy", "Global", "Crypto"];
  chips("newsCats", cats, c => c === state.newsCat, v => { state.newsCat = v; NEWS.shown = 30; save(); RENDER.news(); });
  seg("newsTone", ["All", "Positive", "Negative"], state.newsTone, v => { state.newsTone = v; NEWS.shown = 30; save(); RENDER.news(); });
  const q = el("newsSearch");
  q.oninput = () => { NEWS.shown = 30; RENDER.news(); };
  const term = q.value.trim().toLowerCase();
  const base = items.filter(n => (state.newsCat === "All" || n.category === state.newsCat) && (!term || n.title.toLowerCase().includes(term)) && (!state.newsTag || n.stocks.includes(state.newsTag) || n.coins.includes(state.newsTag)));
  const list = base.filter(n => state.newsTone === "All" || n.tone === state.newsTone);
  const c = { Positive: 0, Negative: 0, Neutral: 0 }; base.forEach(n => c[n.tone]++);
  const tot = base.length || 1, net = (c.Positive - c.Negative) / tot;
  el("newsMood").innerHTML = `<div style="font-size:22px;font-weight:750">${net > 0.08 ? `<span class="mood-row up">${ic("up", 22)}<span>Upbeat</span></span>` : net < -0.08 ? `<span class="mood-row down">${ic("down", 22)}<span>Gloomy</span></span>` : `<span class="mood-row">${ic("flat", 22)}<span>Mixed</span></span>`}</div>
    <div class="stack" style="margin-top:10px"><div style="flex:${c.Positive || 0.001};background:${t.up}">${c.Positive / tot > .12 ? pctu(c.Positive / tot, 0) : ""}</div><div style="flex:${c.Neutral || 0.001};background:${t.muted}">${c.Neutral / tot > .12 ? pctu(c.Neutral / tot, 0) : ""}</div><div style="flex:${c.Negative || 0.001};background:${t.down}">${c.Negative / tot > .12 ? pctu(c.Negative / tot, 0) : ""}</div></div>
    <div class="legend"><span><i style="background:${t.up}"></i>Positive ${c.Positive}</span><span><i style="background:${t.muted}"></i>Neutral ${c.Neutral}</span><span><i style="background:${t.down}"></i>Negative ${c.Negative}</span></div>`;
  const counts = {};
  items.filter(n => state.newsCat === "All" || n.category === state.newsCat).forEach(n => [...n.stocks, ...n.coins].forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  el("newsTags").innerHTML = (state.newsTag ? `<button type="button" class="chip on" data-tag="">✕ ${esc(state.newsTag)}</button>` : "") +
    (top.map(([s, k]) => `<button type="button" class="chip ${s === state.newsTag ? "on" : ""}" data-tag="${esc(s)}">${esc(s)} <b>${k}</b></button>`).join("") || '<span class="mut">No companies or coins mentioned in this topic.</span>');
  el("newsTags").onclick = e => { const b = e.target.closest("[data-tag]"); if (b) { state.newsTag = b.dataset.tag === state.newsTag ? "" : b.dataset.tag; NEWS.shown = 30; save(); RENDER.news(); } };
  el("newsList").innerHTML = list.slice(0, NEWS.shown).map(n => newsCard(n)).join("") || '<div class="card prose"><p>No headlines match. Clear the search or pick another topic.</p></div>';
  el("newsMore").classList.toggle("hidden", list.length <= NEWS.shown);
  el("newsMore").onclick = () => { NEWS.shown += 30; RENDER.news(); };
};
function headlines(filter, n) { return NEWS.data ? NEWS.data.items.filter(filter).slice(0, n) : []; }

// ================================================================= CRYPTO (live from CoinGecko + alternative.me)
const CG = "https://api.coingecko.com/api/v3";
const CRY = { coins: null, global: null, fng: null, usd: null, chart: {}, at: 0, err: null };
async function loadCrypto() {
  const cur = state.cryCur;
  try {
    const [coins, global, fng] = await Promise.all([
      fetch(`${CG}/coins/markets?vs_currency=${cur}&order=market_cap_desc&per_page=25&page=1&sparkline=true&price_change_percentage=1h,24h,7d`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch(`${CG}/global`).then(r => r.json()).catch(() => null),
      fetch("https://api.alternative.me/fng/?limit=31").then(r => r.json()).catch(() => null),
    ]);
    Object.assign(CRY, { coins, global: global && global.data, fng: fng && fng.data, at: Date.now(), err: null, cur });
  } catch (e) { CRY.err = "CoinGecko did not respond (free API limit). Retrying in a minute."; }
}
async function loadCoinChart(id, days, cur) {
  const key = `${id}|${days}|${cur}`;
  if (CRY.chart[key] && Date.now() - CRY.chart[key].at < 120000) return CRY.chart[key].data;
  const r = await fetch(`${CG}/coins/${id}/market_chart?vs_currency=${cur}&days=${days}`).then(x => x.json());
  CRY.chart[key] = { at: Date.now(), data: r.prices || [] };
  return CRY.chart[key].data;
}
const money = (x, cur) => cur === "usd" ? "$" + (Math.abs(x) >= 1e9 ? nf(x / 1e9, 2) + " B" : Math.abs(x) >= 1e6 ? nf(x / 1e6, 2) + " M" : x >= 1 ? x.toLocaleString("en-US", { maximumFractionDigits: 2 }) : x.toPrecision(3))
  : (Math.abs(x) >= 1e12 ? "₹" + nf(x / 1e12, 2) + " L Cr" : Math.abs(x) >= 1e7 ? "₹" + nf(x / 1e7, 0) + " Cr" : x >= 1000 ? "₹" + nf(x, 0) : x >= 1 ? rupee(x) : "₹" + x.toPrecision(3));
RENDER.crypto = function () {
  const t = T();
  seg("cryCur", ["INR", "USD"], state.cryCur.toUpperCase(), v => { state.cryCur = v.toLowerCase(); save(); CRY.coins = null; RENDER.crypto(); });
  if (!CRY.coins || CRY.cur !== state.cryCur) {
    el("cryStatus").textContent = "loading live prices…";
    if (!CRY.coins) { el("cryTiles").innerHTML = Array.from({ length: 6 }, () => '<div class="tile"><span class="skel sk-l2"></span><span class="skel sk-big"></span><span class="skel sk-l2"></span></div>').join(""); el("cryTable").innerHTML = skelCards(5, "skel-row"); }
    loadCrypto().then(() => { if (state.page === "crypto") { if (CRY.coins) RENDER.crypto(); else { el("cryStatus").className = "badge b-down"; el("cryStatus").textContent = CRY.err; } } });
    return;
  }
  const cur = state.cryCur, C = CRY.coins, byId = Object.fromEntries(C.map(c => [c.id, c]));
  el("cryStatus").className = "badge b-up"; el("cryStatus").textContent = `● Live · updated ${new Date(CRY.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
  const g = CRY.global, f = CRY.fng && CRY.fng[0];
  const coinTile = c => tile(`${c.name} (${c.symbol.toUpperCase()})`, money(c.current_price, cur), `${chg(c.price_change_percentage_24h / 100)} 24h · ${chg((c.price_change_percentage_7d_in_currency || 0) / 100, 1)} 7d`);
  el("cryTiles").innerHTML = [coinTile(byId.bitcoin), coinTile(byId.ethereum),
    g ? tile("Total crypto market cap", money(g.total_market_cap[cur], cur), chg(g.market_cap_change_percentage_24h_usd / 100) + " 24h") : "",
    g ? tile("Bitcoin dominance", pctu(g.market_cap_percentage.btc / 100, 1), `ETH ${pctu(g.market_cap_percentage.eth / 100, 1)}`) : "",
    tile("24h trading volume", money((g && g.total_volume[cur]) || sum(C.map(c => c.total_volume || 0)), cur), g && g.total_volume[cur] ? "all coins" : "top 25 coins"),
    f ? tile("Fear & Greed", `${f.value}`, esc(f.value_classification)) : ""].join("");
  // Fear & Greed gauge + history
  if (CRY.fng) {
    const v = +CRY.fng[0].value;
    chart("cryFng", {
      series: [{ type: "gauge", min: 0, max: 100, startAngle: 200, endAngle: -20, radius: "100%", center: ["50%", "62%"],
        axisLine: { lineStyle: { width: 14, color: [[0.25, t.down], [0.45, t.s[1]], [0.55, t.muted], [0.75, t.s[2]], [1, t.up]] } },
        pointer: { width: 5, length: "60%", itemStyle: { color: t.text } }, anchor: { show: true, size: 10, itemStyle: { color: t.text } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: t.muted, distance: -34, fontSize: 10, formatter: x => [0, 25, 50, 75, 100].includes(x) ? x : "" },
        detail: { valueAnimation: true, offsetCenter: [0, "28%"], fontSize: 26, fontWeight: 800, color: t.text, formatter: x => `${x}\n{a|${CRY.fng[0].value_classification}}`, rich: { a: { fontSize: 12, color: t.text2, fontWeight: 500 } } },
        data: [{ value: v }] }],
    });
    const h = [...CRY.fng].reverse();
    chart("cryFngHist", base(t, {
      grid: { left: 8, right: 12, top: 10, bottom: 8, containLabel: true },
      tooltip: { ...base(t).tooltip, formatter: p => `${new Date(+h[p[0].dataIndex].timestamp * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: <b>${p[0].value}</b> ${h[p[0].dataIndex].value_classification}` },
      xAxis: xCat(t, h.map(x => new Date(+x.timestamp * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })), { boundaryGap: false }),
      yAxis: yVal(t, x => x, { min: 0, max: 100, scale: false, splitNumber: 2 }),
      series: [{ type: "line", data: h.map(x => +x.value), showSymbol: false, lineStyle: { width: 2, color: t.s[6] }, itemStyle: { color: t.s[6] }, areaStyle: { color: alpha(t.s[6], 0.12) } }],
    }));
  }
  // table
  el("cryTable").innerHTML = `<table><thead><tr><th>#</th><th>Coin</th><th class="num">Price</th><th class="num">1h</th><th class="num">24h</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">24h volume</th><th>Last 7 days</th></tr></thead><tbody>
    ${C.map(c => { const sp = (c.sparkline_in_7d && c.sparkline_in_7d.price) || []; const up = sp.length && sp[sp.length - 1] >= sp[0];
      return `<tr class="click ${c.id === state.cryCoin ? "sel" : ""}" data-coin="${c.id}"><td class="mut">${c.market_cap_rank}</td>
      <td><div style="display:flex;align-items:center;gap:10px"><img src="${esc(c.image)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer" style="border-radius:50%"><span class="name-cell"><b>${esc(c.name)}</b><span>${esc(c.symbol.toUpperCase())}</span></span></div></td>
      <td class="num"><b>${money(c.current_price, cur)}</b></td><td class="num">${chg((c.price_change_percentage_1h_in_currency || 0) / 100, 1)}</td>
      <td class="num">${chg((c.price_change_percentage_24h || 0) / 100, 1)}</td><td class="num">${chg((c.price_change_percentage_7d_in_currency || 0) / 100, 1)}</td>
      <td class="num">${money(c.market_cap, cur)}</td><td class="num">${money(c.total_volume, cur)}</td>
      <td style="width:110px;position:relative;height:34px">${sp.length ? sparkSVG(sp.filter((_, k) => k % 3 === 0), up ? t.up : t.down, 100, 30).replace('class="spark"', 'class="spark" style="position:static;width:100px;height:30px"') : ""}</td></tr>`; }).join("")}</tbody></table>`;
  el("cryTable").onclick = e => { const r = e.target.closest("[data-coin]"); if (r) { state.cryCoin = r.dataset.coin; save(); RENDER.crypto(); el("cryChart").scrollIntoView({ behavior: "smooth", block: "center" }); } };
  // coin chart
  const coin = byId[state.cryCoin] || byId.bitcoin, days = state.cryDays;
  el("cryChartTitle").textContent = `${coin.name} (${coin.symbol.toUpperCase()}) · ${money(coin.current_price, cur)}`;
  seg("cryDays", ["24H", "7D", "30D", "90D", "1Y"], { 1: "24H", 7: "7D", 30: "30D", 90: "90D", 365: "1Y" }[days], v => { state.cryDays = { "24H": 1, "7D": 7, "30D": 30, "90D": 90, "1Y": 365 }[v]; save(); RENDER.crypto(); });
  loadCoinChart(coin.id, days, cur).then(px => {
    if (state.page !== "crypto" || !px.length) return;
    const first = px[0][1], col = px[px.length - 1][1] >= first ? t.up : t.down;
    chart("cryChart", base(t, {
      grid: { left: 8, right: 18, top: 16, bottom: 8, containLabel: true },
      tooltip: { ...base(t).tooltip, formatter: p => `${new Date(p[0].value[0]).toLocaleString("en-IN", { day: "numeric", month: "short", hour: days <= 7 ? "2-digit" : undefined, minute: days <= 1 ? "2-digit" : undefined })}<br><b>${money(p[0].value[1], cur)}</b> ${chg(p[0].value[1] / first - 1)}` },
      xAxis: { type: "time", axisLine: { lineStyle: { color: t.axis } }, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
      yAxis: yVal(t, v => money(v, cur).replace(/\.\d+/, "")),
      series: [{ type: "line", data: px, showSymbol: false, lineStyle: { width: 2, color: col }, itemStyle: { color: col },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: alpha(col, 0.22) }, { offset: 1, color: alpha(col, 0) }]) } }],
    }));
  }).catch(() => { /* chart stays as it was; the next refresh retries */ });
  // BTC vs NIFTY vs Gold (1 year, INR)
  loadCoinChart("bitcoin", 365, "inr").then(btc => {
    if (state.page !== "crypto" || !btc.length) return;
    const start = isoLocal(new Date(btc[0][0]));
    const byDay = new Map(btc.map(([ts, v]) => [isoLocal(new Date(ts)), v]));
    const i0 = Math.max(0, bisectR(CAL, start) - 1), gold = navSeries(118663);
    const rows = []; let b0, n0, g0;
    for (let i = i0; i < N; i++) {
      const d = CAL[i], b = byDay.get(d), nv = idxAt("NIFTY 50", i), gk = bisectR(gold.d, d) - 1, gv = gk >= 0 ? gold.n[gk] : null;
      if (b == null || gv == null) continue;
      b0 = b0 || b; n0 = n0 || nv; g0 = g0 || gv;
      rows.push([d, b / b0 * 100, nv / n0 * 100, gv / g0 * 100]);
    }
    const ser = [["Bitcoin", 1, t.s[3]], ["NIFTY 50", 2, t.s[0]], ["Gold", 3, t.s[1]]];
    chart("cryVs", base(t, {
      legend: { top: 0, left: 0, textStyle: { color: t.text2 }, itemWidth: 12, itemHeight: 4 },
      grid: { left: 8, right: 18, top: 30, bottom: 8, containLabel: true },
      tooltip: { ...base(t).tooltip, formatter: p => `<b>${fmtDate(p[0].axisValue)}</b><br>${p.map(x => `${x.marker}${x.seriesName}: ${nf(x.value, 1)} (${pct(x.value / 100 - 1, 1)})`).join("<br>")}` },
      xAxis: xCat(t, rows.map(r => r[0]), { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 11, formatter: v => fmtShort(v) } }),
      yAxis: yVal(t, v => v),
      series: ser.map(([n, k, c]) => ({ name: n, type: "line", data: rows.map(r => +r[k].toFixed(2)), showSymbol: false, lineStyle: { width: 2, color: c }, itemStyle: { color: c } })),
    }));
    const last = rows[rows.length - 1];
    el("cryVsStats").innerHTML = rows.length ? ser.map(([n, k, c]) => `<span><i style="background:${c}"></i>${n} <b>${pct(last[k] / 100 - 1, 1)}</b></span>`).join("") : "";
  }).catch(() => {});
  el("cryNews").innerHTML = headlines(n => n.category === "Crypto", 8).map(n => newsCard(n, true)).join("") || '<p class="note">Crypto news loads with the News page data.</p>';
  if (!NEWS.data) loadNews().then(() => { if (state.page === "crypto") el("cryNews").innerHTML = headlines(n => n.category === "Crypto", 8).map(n => newsCard(n, true)).join(""); });
};
// keep live data fresh while the tab is open
setInterval(async () => {
  if (document.hidden) return;
  if (state.page === "crypto") { await loadCrypto(); if (CRY.coins) RENDER.crypto(); }
}, 60000);
setInterval(async () => {
  if (document.hidden) return;
  await loadNews();
  if (state.page === "news") RENDER.news();
  if (state.page === "overview") renderOvNews();
}, 300000);

// headlines on Overview and on each stock page
function renderOvNews() {
  const box = el("ovNews"); if (!box) return;
  newsStatus("ovNewsStatus");
  const list = headlines(n => n.category !== "Crypto", 8);
  box.innerHTML = list.map(n => newsCard(n, true)).join("") || '<p class="note">Loading headlines…</p>';
}
const _overview3 = RENDER.overview;
RENDER.overview = function () { _overview3(); if (NEWS.data) renderOvNews(); else loadNews().then(renderOvNews); };
const _stocks2 = RENDER.stocks;
RENDER.stocks = function () {
  _stocks2();
  const fill = () => {
    const sym = state.stock, list = headlines(n => n.stocks.includes(sym), 6);
    el("stNews").innerHTML = list.map(n => newsCard(n, true)).join("") || `<p class="note">No recent headlines mention ${esc(STK[sym].name)}.</p>`;
  };
  if (NEWS.data) fill(); else loadNews().then(fill);
};

// ================================================================= GLOBAL SEARCH (Ctrl+K or /)
const PAGE_NAMES = { overview: "Market Overview", stocks: "Stock Explorer", compare: "Compare", flow: "Buy / Sell Flow", news: "Market News",
  crypto: "Crypto & Bitcoin", fno: "F&O · Option Chain", funds: "Fund Screener", holdings: "Fund Holdings", advisor: "Advisor & Picks",
  portfolio: "My Portfolio", about: "Methodology" };
const COINS = [["bitcoin", "Bitcoin", "BTC"], ["ethereum", "Ethereum", "ETH"], ["tether", "Tether", "USDT"], ["binancecoin", "BNB", "BNB"],
  ["ripple", "XRP", "XRP"], ["solana", "Solana", "SOL"], ["usd-coin", "USDC", "USDC"], ["dogecoin", "Dogecoin", "DOGE"], ["cardano", "Cardano", "ADA"],
  ["tron", "TRON", "TRX"], ["chainlink", "Chainlink", "LINK"], ["polkadot", "Polkadot", "DOT"], ["litecoin", "Litecoin", "LTC"], ["shiba-inu", "Shiba Inu", "SHIB"]];
const SR = { open: false, items: [], sel: 0, amfi: [], amfiQ: "", timer: null };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
function score(q, ...fields) {
  let best = 0;
  for (const f of fields) {
    const v = norm(f || ""); if (!v) continue;
    if (v === q) best = Math.max(best, 100);
    else if (v.startsWith(q)) best = Math.max(best, 80);
    else if (v.split(" ").some(w => w.startsWith(q))) best = Math.max(best, 60);
    else if (q.split(" ").every(w => v.includes(w))) best = Math.max(best, 40);
  }
  return best;
}
function searchAll(raw) {
  const q = norm(raw), out = [];
  const add = (group, list, n) => { list.filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).forEach(x => out.push({ group, ...x })); };
  if (!q) {
    add("Pages", Object.entries(PAGE_NAMES).map(([k, v]) => ({ s: 1, icon: ic("page"), title: v, sub: "Open page", act: () => { location.hash = k; } })), 12);
    return out;
  }
  add("Stocks", D.stocks.map(s => ({ s: score(q, s.sym, s.name, s.sector), icon: ic("up"), title: `${s.sym} · ${s.name}`, sub: `${s.sector} · ₹${nf(lastClose(s.sym))} ${dayChg(s.sym) >= 0 ? "▲" : "▼"} ${pct(dayChg(s.sym))}`, act: () => openStock(s.sym) })), 6);
  add("Indices", Object.keys(D.indices).map(n => ({ s: score(q, n, n.replace("NIFTY", "nifty").replace("INDIA ", "")), icon: ic("bars"), title: n, sub: `${nf(idxAt(n, N - 1))} · open on Market Overview`, act: () => { state.ovIdx = n; save(); location.hash = "overview"; RENDER.overview && state.page === "overview" && RENDER.overview(); } })), 4);
  add("Mutual funds", D.funds.map(f => ({ s: score(q, f.fund, f.fund_house, f.category), icon: ic("bank"), title: f.fund, sub: `${f.category} · NAV ₹${nf(f.nav)} · score ${f.score == null ? "—" : nf(f.score, 0)}`, act: () => { state.fund = f.scheme_code; save(); location.hash = "funds"; if (state.page === "funds") RENDER.funds(); } })), 6);
  const tracked = new Set(D.funds.map(f => f.scheme_code));
  if (SR.amfiQ === q) add("All AMFI funds (live)", SR.amfi.filter(x => !tracked.has(x.schemeCode)).map(x => ({ s: 10, icon: ic("search"), title: x.schemeName, sub: `AMFI ${x.schemeCode} · click to analyse`, act: async () => {
    try { await loadFund(x.schemeCode); state.extFunds = state.extFunds || []; if (!state.extFunds.includes(x.schemeCode)) state.extFunds.push(x.schemeCode); state.fund = x.schemeCode; save(); location.hash = "funds"; if (state.page === "funds") RENDER.funds(); } catch (e) { /* stays closed; fund screener search can retry */ }
  } })), 6);
  const coins = CRY.coins ? CRY.coins.map(c => [c.id, c.name, c.symbol.toUpperCase(), c.current_price]) : COINS;
  add("Crypto", coins.map(([id, name, sym, px]) => ({ s: score(q, name, sym, id), icon: ic("coin"), title: `${name} (${sym})`, sub: px ? `${money(px, CRY.cur || "inr")} · live` : "Open live chart", act: () => { state.cryCoin = id; save(); location.hash = "crypto"; if (state.page === "crypto") RENDER.crypto(); } })), 4);
  add("Pages", Object.entries(PAGE_NAMES).map(([k, v]) => ({ s: score(q, v, k), icon: ic("page"), title: v, sub: "Open page", act: () => { location.hash = k; } })), 3);
  if (NEWS.data) add("News", NEWS.data.items.map(n => ({ s: q.length >= 3 && norm(n.title).includes(q) ? 20 : 0, icon: ic("news"), title: n.title, sub: `${n.source} · ${timeAgo(n.published)}`, act: () => window.open(n.link, "_blank", "noopener") })), 5);
  return out;
}
function drawSearch() {
  const list = el("gsList");
  if (!SR.items.length) {
    list.innerHTML = `<div class="gs-empty">No matches for “${esc(el("gsInput").value)}”.<br><span>Try a company (Infosys), a symbol (TCS), a fund (Parag Parikh), a coin (bitcoin) or a page (portfolio).</span></div>`;
    return;
  }
  let g = "", html = "";
  SR.items.forEach((it, k) => {
    if (it.group !== g) { g = it.group; html += `<div class="gs-group">${esc(g)}</div>`; }
    html += `<button type="button" class="gs-item ${k === SR.sel ? "on" : ""}" data-k="${k}"><span class="gs-ic">${it.icon}</span><span class="gs-txt"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></span><span class="gs-go">↵</span></button>`;
  });
  if (SR.searching) html += '<div class="gs-group">Searching all AMFI funds…</div>';
  list.innerHTML = html;
  const on = list.querySelector(".gs-item.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function runSearch() {
  const raw = el("gsInput").value;
  SR.items = searchAll(raw); SR.sel = 0; drawSearch();
  const q = norm(raw);
  clearTimeout(SR.timer);
  if (q.length >= 3 && SR.amfiQ !== q) {
    SR.timer = setTimeout(async () => {
      SR.searching = true; drawSearch();
      try {
        const r = await fetch(`${MFAPI}/search?q=${encodeURIComponent(q)}`).then(x => x.json());
        SR.amfi = r.filter(x => /direct/i.test(x.schemeName) && /growth/i.test(x.schemeName) && !/idcw|dividend|bonus/i.test(x.schemeName)); SR.amfiQ = q;
      } catch (e) { SR.amfi = []; }
      SR.searching = false;
      if (SR.open && norm(el("gsInput").value) === q) { SR.items = searchAll(el("gsInput").value); drawSearch(); }
    }, 350);
  }
}
function openSearch(prefill) {
  SR.open = true; el("gs").classList.remove("hidden");
  const inp = el("gsInput"); inp.value = prefill || ""; runSearch();
  setTimeout(() => inp.focus(), 0);
}
function closeSearch() { SR.open = false; el("gs").classList.add("hidden"); }
function pickSearch(k) { const it = SR.items[k]; if (!it) return; closeSearch(); it.act(); }
function setupSearch() {
  el("gsOpen").onclick = () => openSearch();
  el("gs").onclick = e => { if (e.target.id === "gs") closeSearch(); const b = e.target.closest(".gs-item"); if (b) pickSearch(+b.dataset.k); };
  el("gsInput").oninput = runSearch;
  el("gsInput").onkeydown = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); SR.sel = Math.min(SR.items.length - 1, SR.sel + 1); drawSearch(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); SR.sel = Math.max(0, SR.sel - 1); drawSearch(); }
    else if (e.key === "Enter") { e.preventDefault(); pickSearch(SR.sel); }
    else if (e.key === "Escape") closeSearch();
  };
  document.addEventListener("keydown", e => {
    const typing = /input|textarea|select/i.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); SR.open ? closeSearch() : openSearch(); }
    else if (e.key === "/" && !typing && !SR.open) { e.preventDefault(); openSearch(); }
    else if (e.key === "Escape" && SR.open) closeSearch();
  });
}
setupSearch();

// ---------------------------------------------------------------- news visuals: photos, or a designed tile when a story has none
const CAT_ART = { Markets: ["#1e3a8a", "#4338ca", "up"], Stocks: ["#3b0764", "#6d28d9", "building"], "Mutual funds": ["#134e4a", "#0f766e", "bank"],
  Economy: ["#78350f", "#b45309", "landmark"], Global: ["#1e1b4b", "#0e7490", "globe"], Crypto: ["#7c2d12", "#c2410c", "coin"] };
function newsArt(n) {
  const [a, b, icon] = CAT_ART[n.category] || CAT_ART.Markets, sym = n.stocks[0], coin = n.coins[0];
  let inner = `<span class="art-ic">${ic(icon, 30)}</span><span class="art-cat">${esc(n.category)}</span>`;
  if (sym && STK[sym]) {
    const c = P(sym).c.slice(-30), d = dayChg(sym);
    inner = `<span class="art-tk">${sym}</span>${sparkSVG(c, "#ffffff", 120, 34, true).replace('class="spark"', 'class="art-sp"')}<span class="art-ch">${d >= 0 ? "▲" : "▼"} ${pct(d)}</span>`;
  } else if (coin) inner = `<span class="art-ic">${ic("coin", 28)}</span><span class="art-tk">${coin}</span>`;
  return `<div class="news-art" style="background:linear-gradient(135deg,${a},${b})">${inner}</div>`;
}
const newsMedia = (n, cls) => `<div class="news-media ${cls || ""}">${newsArt(n)}${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>`;
newsCard = function (n, compact) {
  const tagsHtml = [...n.stocks.map(s => `<span class="badge b-acc" data-ntag="${s}">${s}</span>`), ...n.coins.map(c => `<span class="badge b-acc" data-ntag="${c}">${c}</span>`)].join(" ");
  if (compact) return `<a class="news-row with-media" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${newsMedia(n, "sm")}<span class="nr-txt"><b>${esc(n.title)}</b><span>${esc(n.source)} · ${timeAgo(n.published)}</span></span></a>`;
  return `<article class="news-card">${newsMedia(n)}
    <div><div class="news-meta"><span class="badge b-neu">${esc(n.category)}</span>${toneBadge(n.tone)}<span class="mut">${esc(n.source)} · ${timeAgo(n.published)}</span></div>
    <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    ${n.summary ? `<p class="news-sum">${esc(n.summary)}</p>` : ""}${tagsHtml ? `<div class="news-tags">${tagsHtml}</div>` : ""}</div></article>`;
};
let topStory = function (n, big) {
  return `<a class="ts ${big ? "ts-big" : ""}" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${newsMedia(n, "ts-img")}
    <div class="ts-shade"></div><div class="ts-body"><div class="ts-meta"><span class="ts-cat">${esc(n.category)}</span><span>${esc(n.source)} · ${timeAgo(n.published)}</span></div>
    <div class="ts-title">${esc(n.title)}</div>${big && n.summary ? `<p class="ts-sum">${esc(n.summary)}</p>` : ""}</div></a>`;
};
const _news = RENDER.news;
RENDER.news = function () {
  _news();
  if (!NEWS.data) return;
  // rebuild the list: top 5 stories with photos as a magazine block, the rest as cards
  const term = el("newsSearch").value.trim().toLowerCase();
  const list = NEWS.data.items.filter(n => (state.newsCat === "All" || n.category === state.newsCat) && (!term || n.title.toLowerCase().includes(term))
    && (!state.newsTag || n.stocks.includes(state.newsTag) || n.coins.includes(state.newsTag)) && (state.newsTone === "All" || n.tone === state.newsTone));
  const top = list.filter(n => n.image).slice(0, 5), rest = list.filter(n => !top.includes(n));
  el("newsTop").innerHTML = top.length >= 3 ? top.map((n, k) => topStory(n, k === 0)).join("") : "";
  el("newsTopWrap").classList.toggle("hidden", top.length < 3);
  const shown = top.length >= 3 ? rest : list;
  el("newsList").innerHTML = shown.slice(0, NEWS.shown).map(n => newsCard(n)).join("") || (top.length ? "" : '<div class="card prose"><p>No headlines match. Clear the search or pick another topic.</p></div>');
  el("newsMore").classList.toggle("hidden", shown.length <= NEWS.shown);
};

// ================================================================= NEWS v3: tabs (headlines / videos / for you / saved), views, sources, bookmarks
const COIN_SYM = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", ripple: "XRP", dogecoin: "DOGE", binancecoin: "BNB" };
NEWS.reg = [];
let forYouTags = function () {
  const t = new Set(state.watch.map(w => w.sym));
  (state.pf || []).filter(h => h.t === "S").forEach(h => t.add(h.id));
  state.cmpItems.filter(x => x.key.startsWith("S:")).forEach(x => t.add(x.key.slice(2)));
  if (state.stock) t.add(state.stock);
  if (COIN_SYM[state.cryCoin]) t.add(COIN_SYM[state.cryCoin]);
  return t;
};
const isSaved = n => state.saved.some(s => s.link === n.link);
function toggleSave(n) {
  state.saved = isSaved(n) ? state.saved.filter(s => s.link !== n.link) : [{ ...n, savedAt: new Date().toISOString() }, ...state.saved].slice(0, 200);
  save();
}
const saveBtn = n => { NEWS.reg.push(n); return `<button type="button" class="save-btn ${isSaved(n) ? "on" : ""}" data-save="${NEWS.reg.length - 1}" title="${isSaved(n) ? "Remove from saved" : "Save to read later"}" aria-label="Save">${isSaved(n) ? "★" : "☆"}</button>`; };
newsCard = function (n, compact) {
  const tagsHtml = [...n.stocks.map(s => `<span class="badge b-acc" data-ntag="${s}">${s}</span>`), ...n.coins.map(c => `<span class="badge b-acc" data-ntag="${c}">${c}</span>`)].join(" ");
  if (compact) return `<div class="news-row-wrap"><a class="news-row with-media" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${newsMedia(n, "sm")}<span class="nr-txt"><b>${esc(n.title)}</b><span>${esc(n.source)} · ${timeAgo(n.published)}</span></span></a>${state.page === "news" ? saveBtn(n) : ""}</div>`;
  return `<article class="news-card">${newsMedia(n)}
    <div><div class="news-meta"><span class="badge b-neu">${esc(n.category)}</span>${toneBadge(n.tone)}<span class="mut">${esc(n.source)} · ${timeAgo(n.published)}</span>${saveBtn(n)}</div>
    <a class="news-title" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    ${n.summary ? `<p class="news-sum">${esc(n.summary)}</p>` : ""}${tagsHtml ? `<div class="news-tags">${tagsHtml}</div>` : ""}</div></article>`;
};
topStory = function (n, big) {
  return `<div class="ts-wrap ${big ? "ts-big" : ""}"><a class="ts" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${newsMedia(n, "ts-img")}
    <div class="ts-shade"></div><div class="ts-body"><div class="ts-meta"><span class="ts-cat">${esc(n.category)}</span><span>${esc(n.source)} · ${timeAgo(n.published)}</span></div>
    <div class="ts-title">${esc(n.title)}</div>${big && n.summary ? `<p class="ts-sum">${esc(n.summary)}</p>` : ""}</div></a>${saveBtn(n)}</div>`;
};
function timeline(list) {
  let out = "", last = "";
  const today = isoLocal(new Date()), yest = isoLocal(new Date(Date.now() - 864e5));
  list.forEach(n => {
    const d = new Date(n.published), day = isoLocal(d);
    const label = `${day === today ? "Today" : day === yest ? "Yesterday" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ${String(d.getHours()).padStart(2, "0")}:00`;
    if (label !== last) { out += `<div class="tl-head">${label}</div>`; last = label; }
    out += `<div class="tl-item"><span class="tl-time">${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>${newsCard(n, true)}</div>`;
  });
  return out;
}
function openVideo(v) {
  el("vpTitle").textContent = v.title;
  el("vpMeta").textContent = `${v.channel} · ${timeAgo(v.published)}${v.views ? ` · ${nf(v.views, 0)} views` : ""}`;
  el("vpYT").href = `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`;
  el("vpFrame").src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`;
  el("vp").classList.remove("hidden");
}
function closeVideo() { el("vpFrame").src = "about:blank"; el("vp").classList.add("hidden"); }

const skelCards = (n, cls = "skel-card") => Array.from({ length: n }, () => `<div class="${cls}"><span class="skel sk-img"></span><span class="skel sk-l1"></span><span class="skel sk-l2"></span></div>`).join("");
RENDER.news = function () {
  if (!NEWS.data) { el("newsList").className = "news-grid"; el("newsList").innerHTML = skelCards(6); el("newsTopWrap").classList.add("hidden"); loadNews().then(() => state.page === "news" && RENDER.news()); return; }
  const t = T(), D_ = NEWS.data, vids = D_.videos || [];
  NEWS.reg = [];
  newsStatus("newsStatus");
  el("newsRefresh").onclick = async () => { el("newsRefresh").textContent = "Refreshing…"; await loadNews(); el("newsRefresh").textContent = "↻ Refresh"; RENDER.news(); };
  const fy = forYouTags();
  const tabs = [["Headlines", D_.items.length], ["Videos", vids.length], ["For you", D_.items.filter(n => n.stocks.some(s => fy.has(s)) || n.coins.some(c => fy.has(c))).length], ["Saved", state.saved.length]];
  el("newsTabs").innerHTML = tabs.map(([k, c]) => `<button type="button" class="news-tab ${state.newsTab === k ? "on" : ""}" data-tab="${k}">${ic({ Headlines: "news", Videos: "play", "For you": "sparkle", Saved: "star" }[k], 16)} ${k}<span>${c}</span></button>`).join("");
  el("newsTabs").onclick = e => { const b = e.target.closest("[data-tab]"); if (b) { state.newsTab = b.dataset.tab; NEWS.shown = 30; save(); RENDER.news(); } };
  const isVid = state.newsTab === "Videos";
  ["newsInsights", "newsTopWrap", "newsList"].forEach(id => el(id).classList.toggle("hidden", isVid));
  document.querySelector("#page-news > .filters").classList.toggle("hidden", isVid);
  el("newsVideos").classList.toggle("hidden", !isVid);
  el("newsMore").classList.add("hidden");
  el("newsForYouNote").classList.add("hidden");

  if (isVid) {
    const chans = ["All", ...new Set(vids.map(v => v.channel))];
    chips("vidChans", chans, c => c === state.vidChan, v => { state.vidChan = v; save(); RENDER.news(); });
    const list = vids.filter(v => state.vidChan === "All" || v.channel === state.vidChan);
    el("vidGrid").innerHTML = list.map((v, k) => `<button type="button" class="vid" data-v="${k}"><div class="vid-thumb"><img src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="vid-play">▶</span><span class="vid-ch">${esc(v.channel)}</span></div>
      <div class="vid-body"><b>${esc(v.title)}</b><span>${timeAgo(v.published)}${v.views ? ` · ${nf(v.views, 0)} views` : ""}</span></div></button>`).join("") || '<div class="card prose"><p>No videos right now. Click Refresh.</p></div>';
    el("vidGrid").onclick = e => { const b = e.target.closest("[data-v]"); if (b) openVideo(list[+b.dataset.v]); };
    el("vpClose").onclick = closeVideo;
    el("vp").onclick = e => { if (e.target.id === "vp") closeVideo(); };
    return;
  }

  let base = state.newsTab === "Saved" ? state.saved : state.newsTab === "For you" ? D_.items.filter(n => n.stocks.some(s => fy.has(s)) || n.coins.some(c => fy.has(c))) : D_.items;
  if (state.newsTab === "For you") {
    el("newsForYouNote").classList.remove("hidden");
    el("newsForYouNote").innerHTML = fy.size ? `Personalised for: ${[...fy].map(s => `<span class="badge b-acc">${esc(s)}</span>`).join(" ")} (from your watchlist, portfolio, comparisons and the stock / coin you opened last).`
      : "Add stocks to your watchlist or portfolio to personalise this feed.";
  }
  if (state.newsTab === "Saved" && !base.length) {
    el("newsInsights").classList.add("hidden"); el("newsTopWrap").classList.add("hidden");
    el("newsList").innerHTML = '<div class="card prose"><h3>Nothing saved yet</h3><p>Click ☆ on any story to keep it here. Saved stories stay in this browser even after they leave the live feed.</p></div>';
    return;
  }
  const cats = ["All", "Markets", "Stocks", "Mutual funds", "Economy", "Global", "Crypto"];
  chips("newsCats", cats, c => c === state.newsCat, v => { state.newsCat = v; NEWS.shown = 30; save(); RENDER.news(); });
  seg("newsTone", ["All", "Positive", "Negative"], state.newsTone, v => { state.newsTone = v; NEWS.shown = 30; save(); RENDER.news(); });
  seg("newsView", ["Magazine", "Compact", "Timeline"], state.newsView, v => { state.newsView = v; NEWS.shown = 30; save(); RENDER.news(); });
  const srcCount = {}; base.forEach(n => { srcCount[n.source] = (srcCount[n.source] || 0) + 1; });
  const srcs = Object.entries(srcCount).sort((a, b) => b[1] - a[1]);
  if (state.newsSrc && !srcCount[state.newsSrc]) state.newsSrc = "";
  el("newsSrc").innerHTML = `<option value="">All sources (${srcs.length})</option>` + srcs.map(([s, c]) => `<option value="${esc(s)}" ${s === state.newsSrc ? "selected" : ""}>${esc(s)} (${c})</option>`).join("");
  el("newsSrc").onchange = e => { state.newsSrc = e.target.value; NEWS.shown = 30; save(); RENDER.news(); };
  const q = el("newsSearch"); q.oninput = () => { NEWS.shown = 30; RENDER.news(); };
  const term = q.value.trim().toLowerCase();
  const pre = base.filter(n => (state.newsCat === "All" || n.category === state.newsCat) && (!state.newsSrc || n.source === state.newsSrc) && (!term || n.title.toLowerCase().includes(term))
    && (!state.newsTag || n.stocks.includes(state.newsTag) || n.coins.includes(state.newsTag)));
  const list = pre.filter(n => state.newsTone === "All" || n.tone === state.newsTone);

  // insights
  const c = { Positive: 0, Negative: 0, Neutral: 0 }; pre.forEach(n => c[n.tone]++);
  const tot = pre.length || 1, net = (c.Positive - c.Negative) / tot;
  el("newsMood").innerHTML = `<div style="font-size:22px;font-weight:750">${net > 0.08 ? `<span class="mood-row up">${ic("up", 22)}<span>Upbeat</span></span>` : net < -0.08 ? `<span class="mood-row down">${ic("down", 22)}<span>Gloomy</span></span>` : `<span class="mood-row">${ic("flat", 22)}<span>Mixed</span></span>`}</div>
    <div class="stack" style="margin-top:10px"><div style="flex:${c.Positive || 0.001};background:${t.up}">${c.Positive / tot > .12 ? pctu(c.Positive / tot, 0) : ""}</div><div style="flex:${c.Neutral || 0.001};background:${t.muted}">${c.Neutral / tot > .12 ? pctu(c.Neutral / tot, 0) : ""}</div><div style="flex:${c.Negative || 0.001};background:${t.down}">${c.Negative / tot > .12 ? pctu(c.Negative / tot, 0) : ""}</div></div>
    <div class="legend"><span><i style="background:${t.up}"></i>Positive ${c.Positive}</span><span><i style="background:${t.muted}"></i>Neutral ${c.Neutral}</span><span><i style="background:${t.down}"></i>Negative ${c.Negative}</span></div>`;
  const counts = {}; base.forEach(n => [...n.stocks, ...n.coins].forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  el("newsTags").innerHTML = (state.newsTag ? `<button type="button" class="chip on" data-tag="${esc(state.newsTag)}">✕ ${esc(state.newsTag)}</button>` : "") +
    (top.filter(([s]) => s !== state.newsTag).map(([s, k]) => `<button type="button" class="chip" data-tag="${esc(s)}">${esc(s)} <b>${k}</b></button>`).join("") || '<span class="mut">No companies or coins mentioned.</span>');
  el("newsTags").onclick = e => { const b = e.target.closest("[data-tag]"); if (b) { state.newsTag = b.dataset.tag === state.newsTag ? "" : b.dataset.tag; NEWS.shown = 30; save(); RENDER.news(); } };

  // list in the chosen view
  const view = state.newsView, magazine = view === "Magazine";
  const topList = magazine ? list.filter(n => n.image).slice(0, 5) : [];
  const useTop = topList.length >= 3;
  el("newsTopWrap").classList.toggle("hidden", !useTop);
  el("newsTop").innerHTML = useTop ? topList.map((n, k) => topStory(n, k === 0)).join("") : "";
  const rest = useTop ? list.filter(n => !topList.includes(n)) : list, page = rest.slice(0, NEWS.shown);
  const box = el("newsList");
  box.className = view === "Compact" ? "news-cols card" : view === "Timeline" ? "timeline card" : "news-grid";
  box.innerHTML = !list.length ? '<div class="card prose"><p>No headlines match. Clear the search, source or topic filter.</p></div>'
    : view === "Timeline" ? timeline(page) : page.map(n => newsCard(n, view === "Compact")).join("");
  el("newsMore").classList.toggle("hidden", rest.length <= NEWS.shown);
  el("newsMore").onclick = () => { NEWS.shown += 30; RENDER.news(); };
  el("page-news").onclick = e => {
    const sb = e.target.closest("[data-save]");
    if (sb) { e.preventDefault(); e.stopPropagation(); toggleSave(NEWS.reg[+sb.dataset.save]); RENDER.news(); return; }
    const tg = e.target.closest("[data-ntag]"); if (tg) { state.newsTag = tg.dataset.ntag; save(); RENDER.news(); }
  };
};
document.addEventListener("keydown", e => { if (e.key === "Escape" && !el("vp").classList.contains("hidden")) closeVideo(); });

// ================================================================= BACKGROUNDS (picker in the top bar; choice saved in this browser)
const BGS = [
  { id: "gold", name: "Gold & Black", sw: "radial-gradient(circle at 70% 20%,#d4af37,#3a2b0c 45%,#060607 80%)" },
  { id: "waves", name: "Market Waves", sw: "linear-gradient(135deg,#0b1430,#1e3a8a 45%,#6d28d9)" },
  { id: "candles", name: "Candlesticks", sw: "linear-gradient(135deg,#0a1a14,#0f3d2e 50%,#3b0d14)" },
  { id: "network", name: "Data Network", sw: "radial-gradient(circle at 30% 30%,#1d4ed8,#0a0f1c 70%)" },
  { id: "aurora", name: "Aurora", sw: "linear-gradient(135deg,#1e3a8a,#0d9488 50%,#7c3aed)" },
  { id: "sunset", name: "Sunset", sw: "linear-gradient(135deg,#4c1d95,#be185d 50%,#ea580c)" },
  { id: "clean", name: "Clean", sw: "linear-gradient(135deg,#111a2b,#18233a)" },
];
const BG = { raf: 0, ctx: null, w: 0, h: 0, t: 0, nodes: [], candles: [], last: 0 };
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => css("color-scheme") === "dark";
function bgSize() {
  const c = el("bgfx"), dpr = Math.min(window.devicePixelRatio || 1, 2);
  BG.w = innerWidth; BG.h = innerHeight;
  c.width = BG.w * dpr; c.height = BG.h * dpr; c.style.width = BG.w + "px"; c.style.height = BG.h + "px";
  BG.ctx = c.getContext("2d"); BG.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function drawWaves(time) {
  const g = BG.ctx, { w, h } = BG, dark = isDark();
  g.clearRect(0, 0, w, h);
  const cols = dark ? ["59,130,246", "139,92,246", "16,185,129", "236,72,153"] : ["37,99,235", "124,58,237", "13,148,136", "219,39,119"];
  for (let k = 0; k < 7; k++) {
    const col = cols[k % cols.length], base = h * (0.28 + k * 0.085), amp = 28 + k * 9, speed = 0.00012 * (k % 2 ? 1 : -1) * (1 + k * 0.15);
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = base + Math.sin(x * 0.0042 + time * speed * 6 + k) * amp + Math.sin(x * 0.011 + time * speed * 11 + k * 2) * amp * 0.35
        + Math.sin(x * 0.027 + k * 5) * 6;  // the jagged last term makes it read as a price line
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `rgba(${col},0)`); grad.addColorStop(0.3, `rgba(${col},${dark ? 0.55 : 0.35})`); grad.addColorStop(0.7, `rgba(${col},${dark ? 0.45 : 0.3})`); grad.addColorStop(1, `rgba(${col},0)`);
    g.strokeStyle = grad; g.lineWidth = k === 3 ? 2.2 : 1.3;
    g.shadowColor = `rgba(${col},0.9)`; g.shadowBlur = dark ? 14 : 6;
    g.stroke();
  }
  g.shadowBlur = 0;
}
function initCandles() {
  BG.candles = []; let p = 100;
  for (let i = 0; i < 200; i++) { const o = p, c = o * (1 + (Math.random() - 0.48) * 0.04); BG.candles.push({ o, c, h: Math.max(o, c) * (1 + Math.random() * 0.015), l: Math.min(o, c) * (1 - Math.random() * 0.015) }); p = c; }
}
function drawCandles(time) {
  const g = BG.ctx, { w, h } = BG, dark = isDark(), cw = 18, off = (time * 0.012) % cw;
  g.clearRect(0, 0, w, h);
  const n = Math.ceil(w / cw) + 2, start = Math.floor(time * 0.012 / cw) % (BG.candles.length - n - 1);
  const slice = BG.candles.slice(start, start + n), hi = Math.max(...slice.map(c => c.h)), lo = Math.min(...slice.map(c => c.l));
  const y = v => h * 0.18 + (1 - (v - lo) / (hi - lo)) * h * 0.64;
  slice.forEach((c, i) => {
    const x = i * cw - off, up = c.c >= c.o, col = up ? (dark ? "52,211,153" : "16,163,74") : (dark ? "248,113,113" : "220,38,38"), a = dark ? 0.32 : 0.2;
    g.strokeStyle = `rgba(${col},${a})`; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x + cw / 2, y(c.h)); g.lineTo(x + cw / 2, y(c.l)); g.stroke();
    g.fillStyle = `rgba(${col},${a + 0.06})`;
    g.fillRect(x + 4, Math.min(y(c.o), y(c.c)), cw - 8, Math.max(2, Math.abs(y(c.o) - y(c.c))));
  });
  // moving average glow line
  g.beginPath();
  slice.forEach((c, i) => { const avg = slice.slice(Math.max(0, i - 8), i + 1).reduce((s, x) => s + x.c, 0) / Math.min(i + 1, 9); const px = i * cw - off + cw / 2; i ? g.lineTo(px, y(avg)) : g.moveTo(px, y(avg)); });
  g.strokeStyle = dark ? "rgba(96,165,250,0.55)" : "rgba(37,99,235,0.4)"; g.lineWidth = 2; g.shadowColor = "rgba(96,165,250,0.9)"; g.shadowBlur = dark ? 12 : 4; g.stroke(); g.shadowBlur = 0;
}
function initNodes() {
  const n = Math.round(Math.min(90, BG.w * BG.h / 16000));
  BG.nodes = Array.from({ length: n }, () => ({ x: Math.random() * BG.w, y: Math.random() * BG.h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: 1 + Math.random() * 1.8 }));
}
function drawNetwork() {
  const g = BG.ctx, { w, h } = BG, dark = isDark(), col = dark ? "96,165,250" : "37,99,235", col2 = dark ? "167,139,250" : "124,58,237";
  g.clearRect(0, 0, w, h);
  BG.nodes.forEach(p => { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; });
  for (let i = 0; i < BG.nodes.length; i++) for (let j = i + 1; j < BG.nodes.length; j++) {
    const a = BG.nodes[i], b = BG.nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 150) { g.strokeStyle = `rgba(${(i + j) % 3 ? col : col2},${(1 - d / 150) * (dark ? 0.35 : 0.22)})`; g.lineWidth = 1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  }
  BG.nodes.forEach((p, i) => { g.fillStyle = `rgba(${i % 3 ? col : col2},${dark ? 0.9 : 0.6})`; g.shadowColor = `rgba(${col},1)`; g.shadowBlur = dark ? 10 : 3; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill(); });
  g.shadowBlur = 0;
}
function initDust() {
  BG.dust = Array.from({ length: Math.round(Math.min(110, BG.w * BG.h / 12000)) }, () => ({ x: Math.random() * BG.w, y: Math.random() * BG.h,
    r: 0.4 + Math.random() * 1.6, v: 0.08 + Math.random() * 0.25, p: Math.random() * 6.28, s: 0.01 + Math.random() * 0.03 }));
}
function drawDust() {
  const g = BG.ctx, { w, h } = BG;
  g.clearRect(0, 0, w, h);
  BG.dust.forEach(d => {
    d.y -= d.v; d.x += Math.sin(d.p) * 0.15; d.p += d.s;
    if (d.y < -5) { d.y = h + 5; d.x = Math.random() * w; }
    const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(d.p * 2));
    g.fillStyle = `rgba(243,210,122,${a})`; g.shadowColor = "rgba(212,175,55,0.9)"; g.shadowBlur = 8;
    g.beginPath(); g.arc(d.x, d.y, d.r, 0, 6.283); g.fill();
  });
  g.shadowBlur = 0;
}
function bgLoop(ts) {
  BG.raf = requestAnimationFrame(bgLoop);
  if (document.hidden || ts - BG.last < 33) return;  // ~30 fps is plenty for a background
  BG.last = ts;
  const id = document.documentElement.dataset.bg;
  if (id === "waves") drawWaves(ts); else if (id === "candles") drawCandles(ts); else if (id === "network") drawNetwork(); else if (id === "gold") drawDust();
}
function setBackground(id) {
  if (!BGS.some(b => b.id === id)) id = "gold";
  state.bg = id; save();
  document.documentElement.dataset.bg = id;
  cancelAnimationFrame(BG.raf);
  const canvasBg = ["gold", "waves", "candles", "network"].includes(id);
  el("brandLogo").src = el("footLogo").src = id === "gold" ? "logo-gold.svg" : "logo.svg";
  el("bgfx").classList.toggle("hidden", !canvasBg);
  if (canvasBg) {
    bgSize();
    if (id === "candles") initCandles();
    if (id === "network") initNodes();
    if (id === "gold") initDust();
    if (reduceMotion()) { const f = { gold: drawDust, waves: drawWaves, candles: drawCandles, network: drawNetwork }[id]; f(20000); }
    else BG.raf = requestAnimationFrame(bgLoop);
  }
  document.querySelectorAll("#bgMenu [data-bg]").forEach(b => b.classList.toggle("on", b.dataset.bg === id));
}
function setupBackgrounds() {
  el("bgMenu").innerHTML = `<div class="bg-title">Background</div><div class="bg-grid">${BGS.map(b => `<button type="button" data-bg="${b.id}"><span class="bg-sw" style="background:${b.sw}"></span>${b.name}</button>`).join("")}</div>`;
  el("bgBtn").onclick = e => { e.stopPropagation(); el("bgMenu").classList.toggle("hidden"); };
  el("bgMenu").onclick = e => { const b = e.target.closest("[data-bg]"); if (b) setBackground(b.dataset.bg); e.stopPropagation(); };
  document.addEventListener("click", () => el("bgMenu").classList.add("hidden"));
  window.addEventListener("resize", () => { if (["gold", "waves", "candles", "network"].includes(state.bg)) { bgSize(); if (state.bg === "network") initNodes(); if (state.bg === "gold") initDust(); } });
  setBackground(state.bg || "gold");
  // the theme button cannot switch the always-dark gold theme; say so instead of doing nothing
  el("themeBtn").title = "Toggle dark mode (Gold & Black is always dark)";
}
setupBackgrounds();

// ================================================================= MULTIPLE WATCHLISTS
// state.watch always points at the active list's items, so the older code that reads it keeps working.
function initWatchlists() {
  if (!Array.isArray(state.watchlists) || !state.watchlists.length) {
    state.watchlists = [
      { name: "My Watchlist", items: (state.watch || []).map(w => ({ sym: w.sym, above: w.above || 0, below: w.below || 0 })) },
      { name: "Long Term", items: [] }, { name: "Trading", items: [] }, { name: "Dividend", items: [] },
    ];
  }
  state.wlActive = Math.min(Math.max(0, state.wlActive || 0), state.watchlists.length - 1);
  state.watch = state.watchlists[state.wlActive].items;
}
const allWatched = () => [...new Set(state.watchlists.flatMap(l => l.items.map(w => w.sym)))];
function setActiveList(i) { state.wlActive = i; state.watch = state.watchlists[i].items; save(); }
const WL = { mode: null };  // null | "new" | "rename"

renderWatch = function () {
  initWatchlists();
  const box = el("ovWatch"), lists = state.watchlists, act = state.wlActive;
  const bar = `<div class="wl-bar">
    <div class="wl-tabs">${lists.map((l, i) => `<button type="button" class="wl-tab ${i === act ? "on" : ""}" data-wl="${i}">${esc(l.name)}<span>${l.items.length}</span></button>`).join("")}
      ${lists.length < 8 ? `<button type="button" class="wl-tab wl-add" data-wl-new="1">+ New list</button>` : ""}</div>
    <div class="wl-actions">
      ${WL.mode ? `<input class="text-in" id="wlName" maxlength="24" placeholder="List name" value="${WL.mode === "rename" ? esc(lists[act].name) : ""}" style="width:170px">
        <button type="button" class="btn sm primary" data-wl-ok="1">${WL.mode === "new" ? "Create" : "Save"}</button><button type="button" class="btn sm" data-wl-cancel="1">Cancel</button>`
      : `<button type="button" class="btn sm" data-wl-rename="1">Rename</button>${lists.length > 1 ? `<button type="button" class="btn sm" data-wl-del="1">Delete list</button>` : ""}`}
      <select id="wlAddSel" aria-label="Add a stock"><option value="">+ Add stock</option>${D.stocks.filter(s => !state.watch.some(w => w.sym === s.sym)).map(s => `<option value="${s.sym}">${s.sym} · ${esc(s.name)}</option>`).join("")}</select>
    </div></div>`;
  const W = state.watch.filter(w => STK[w.sym]);
  let table;
  if (!W.length) table = `<p class="note">“${esc(lists[act].name)}” is empty. Use <b>+ Add stock</b> above, or open a stock in the Stock Explorer and click <b>☆ Watch</b>.</p>`;
  else {
    const [i0, i1] = rangeIdx();
    table = `<div class="table-wrap"><table><thead><tr><th>Stock</th><th class="num">Price</th><th class="num">Day</th><th class="num">Period</th><th>Signal</th><th class="num">vs 52-wk high</th><th class="num">Alert above ₹</th><th class="num">Alert below ₹</th><th>Alert</th><th></th></tr></thead><tbody>
    ${W.map(w => {
      const s = STK[w.sym], px = lastClose(w.sym), { hi } = high52(w.sym);
      const up = w.above > 0 && px >= w.above, dn = w.below > 0 && px <= w.below;
      const status = up ? `<span class="badge b-up">▲ above ${nf(w.above)}</span>` : dn ? `<span class="badge b-down">▼ below ${nf(w.below)}</span>`
        : (w.above || w.below) ? '<span class="badge b-neu">waiting</span>' : '<span class="mut">set a price</span>';
      return `<tr ${up || dn ? 'class="sel"' : ""}><td class="name-cell"><a href="#stocks" data-open="${w.sym}" style="text-decoration:none;color:inherit"><b>${w.sym}</b><span>${esc(s.name)}</span></a></td>
        <td class="num">${nf(px)}</td><td class="num">${chg(dayChg(w.sym))}</td><td class="num">${chg(stockRet(w.sym, i0, i1), 1)}</td><td>${sigBadge(s.signal)}</td>
        <td class="num">${pct(px / hi - 1, 1)}</td>
        <td class="num"><input class="text-in" type="number" step="any" min="0" style="width:96px" data-w="${w.sym}" data-f="above" value="${w.above || ""}" placeholder="${nf(px * 1.05, 0)}"></td>
        <td class="num"><input class="text-in" type="number" step="any" min="0" style="width:96px" data-w="${w.sym}" data-f="below" value="${w.below || ""}" placeholder="${nf(px * 0.95, 0)}"></td>
        <td>${status}</td><td><button type="button" class="btn sm" data-unwatch="${w.sym}" aria-label="Remove from list">✕</button></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  // summary of the active list
  const sumHtml = W.length ? (() => {
    const d = W.map(w => dayChg(w.sym)), avg = sum(d) / d.length, best = W[d.indexOf(Math.max(...d))], worst = W[d.indexOf(Math.min(...d))];
    const alerts = W.filter(w => (w.above > 0 && lastClose(w.sym) >= w.above) || (w.below > 0 && lastClose(w.sym) <= w.below)).length;
    return `<div class="wl-sum"><span>${W.length} stock${W.length > 1 ? "s" : ""}</span><span>Avg day ${chg(avg)}</span><span>Best <b>${best.sym}</b> ${chg(Math.max(...d))}</span><span>Worst <b>${worst.sym}</b> ${chg(Math.min(...d))}</span><span>${alerts ? `<span class="badge b-acc">${alerts} alert${alerts > 1 ? "s" : ""} triggered</span>` : "No alerts triggered"}</span></div>`;
  })() : "";
  box.innerHTML = bar + sumHtml + table;
  const nameBox = el("wlName"); if (nameBox) { nameBox.focus(); nameBox.onkeydown = e => { if (e.key === "Enter") box.querySelector("[data-wl-ok]").click(); if (e.key === "Escape") { WL.mode = null; renderWatch(); } }; }
  el("wlAddSel").onchange = e => { if (e.target.value) { state.watch.push({ sym: e.target.value, above: 0, below: 0 }); save(); renderWatch(); } };
  box.onchange = e => { const x = e.target; if (!x.dataset.w) return; const w = state.watch.find(v => v.sym === x.dataset.w); w[x.dataset.f] = +x.value || 0; save(); renderWatch(); };
  box.onclick = e => {
    const t = e.target.closest("button, a"); if (!t) return;
    if (t.dataset.wl != null) { WL.mode = null; setActiveList(+t.dataset.wl); renderWatch(); }
    else if (t.dataset.wlNew) { WL.mode = "new"; renderWatch(); }
    else if (t.dataset.wlRename) { WL.mode = "rename"; renderWatch(); }
    else if (t.dataset.wlCancel) { WL.mode = null; renderWatch(); }
    else if (t.dataset.wlOk) {
      const name = (el("wlName").value || "").trim().slice(0, 24) || `List ${state.watchlists.length + 1}`;
      if (WL.mode === "new") { state.watchlists.push({ name, items: [] }); setActiveList(state.watchlists.length - 1); }
      else { state.watchlists[state.wlActive].name = name; save(); }
      WL.mode = null; renderWatch();
    } else if (t.dataset.wlDel) {
      if (t.dataset.confirm) { state.watchlists.splice(state.wlActive, 1); setActiveList(0); renderWatch(); }
      else { t.dataset.confirm = "1"; t.textContent = "Click again to delete"; t.classList.add("danger"); }
    } else if (t.dataset.unwatch) { const i = state.watch.findIndex(v => v.sym === t.dataset.unwatch); state.watch.splice(i, 1); save(); renderWatch(); }
    else if (t.dataset.open) { e.preventDefault(); openStock(t.dataset.open); }
  };
};

// Stock Explorer: choose which lists the stock belongs to
const _stocks3 = RENDER.stocks;
RENDER.stocks = function () {
  _stocks3();
  initWatchlists();
  const sym = state.stock, btn = el("stWatch");
  const inLists = state.watchlists.filter(l => l.items.some(w => w.sym === sym));
  btn.innerHTML = inLists.length ? `★ In ${inLists.length === 1 ? esc(inLists[0].name) : inLists.length + " lists"}` : "☆ Watch";
  btn.classList.toggle("primary", inLists.length > 0);
  let menu = el("wlMenu");
  if (!menu) { btn.insertAdjacentHTML("afterend", '<div class="wl-menu hidden" id="wlMenu"></div>'); menu = el("wlMenu"); btn.parentElement.style.position = "relative"; }
  const draw = () => {
    menu.innerHTML = `<div class="bg-title">Add ${esc(sym)} to</div>${state.watchlists.map((l, i) => { const on = l.items.some(w => w.sym === sym);
      return `<button type="button" class="wl-opt ${on ? "on" : ""}" data-i="${i}"><span class="wl-check">${on ? "✓" : ""}</span>${esc(l.name)}<span class="mut">${l.items.length}</span></button>`; }).join("")}
      <p class="note" style="margin:8px 4px 2px">Manage lists on Market Overview.</p>`;
  };
  btn.onclick = e => { e.stopPropagation(); draw(); menu.classList.toggle("hidden"); };
  menu.onclick = e => {
    e.stopPropagation();
    const b = e.target.closest("[data-i]"); if (!b) return;
    const l = state.watchlists[+b.dataset.i], k = l.items.findIndex(w => w.sym === sym);
    if (k >= 0) l.items.splice(k, 1); else l.items.push({ sym, above: 0, below: 0 });
    save(); draw();
    const n = state.watchlists.filter(x => x.items.some(w => w.sym === sym));
    btn.innerHTML = n.length ? `★ In ${n.length === 1 ? esc(n[0].name) : n.length + " lists"}` : "☆ Watch";
    btn.classList.toggle("primary", n.length > 0);
  };
  document.addEventListener("click", () => menu.classList.add("hidden"), { once: true });
};
// personalised news follows every list, not only the active one
const _forYouTags = forYouTags;
forYouTags = function () { const t = _forYouTags(); allWatched().forEach(s => t.add(s)); return t; };
initWatchlists();

// ---------------------------------------------------------------- boot
setupShell();
renderRangeBar();
go(location.hash.slice(1) || state.page);
const pfFunds = (state.pf || []).filter(h => h.t === "F").map(h => +h.id);
Promise.allSettled([...new Set([...(state.extFunds || []), ...pfFunds])].filter(c => !FUND[c]).map(loadFund))
  .then(rs => { if (rs.length && ["funds", "portfolio"].includes(state.page)) render(); });
