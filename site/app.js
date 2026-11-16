/* Fund Performance Tracker — static dashboard, no dependencies.
 * Reads data.json (built by scripts/build_site.py) and computes every metric
 * in the browser so the numbers always match the stored NAV history.
 * All upstream text is passed through esc() before it is inserted as HTML. */
"use strict";

const SINCE = "2022-01-01";
const DAY = 86400000;

// ---------- formatting ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
const fmtMonth = (s) => { if (!s) return "—"; const [y, m] = s.split("-"); return `${MONTHS[+m - 1]} ${y}`; };
const fmtYYYYMM = (s) => s ? fmtMonth(`${s.slice(0, 4)}-${s.slice(4, 6)}`) : "—";
const fmtNav = (v) => v == null ? "—" : "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtINR = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
const fmtPct = (r, dp = 1) => r == null || !isFinite(r) ? "—" : (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r * 100).toFixed(dp) + "%";
const cls = (r, dp = 1) => { if (r == null || !isFinite(r)) return "flat"; const q = +(r * 100).toFixed(dp); return q > 0 ? "up" : q < 0 ? "down" : "flat"; };
/** Signed % with an arrow; sign and colour follow the rounded value so "0.0%" never gets an arrow. */
const pctSpan = (r, dp = 1) => { const c = cls(r, dp); return `<span class="${c}">${r == null ? "—" : (c === "up" ? "▲ " : c === "down" ? "▼ " : "") + (Math.abs(r * 100).toFixed(dp) + "%")}</span>`; };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- dates ----------
const toTs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const toISO = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => toISO(toTs(s) + n * DAY);
function addMonths(s, n) {
  let y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n;
  const d = +s.slice(8, 10);
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(Date.UTC(y, m, Math.min(d, last)));
}
const daysBetween = (a, b) => (toTs(b) - toTs(a)) / DAY;

// ---------- series math ----------
/** index of last point with date <= s, or -1 */
function idxAtOrBefore(d, s) {
  let lo = 0, hi = d.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (d[mid] <= s) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

const WINDOWS = [
  { key: "1D", label: "1 day", base: (f) => f.d.length > 1 ? f.d.length - 2 : -1 },
  { key: "1W", label: "1 week", base: (f, last) => idxAtOrBefore(f.d, addDays(last, -7)) },
  { key: "2W", label: "2 weeks", base: (f, last) => idxAtOrBefore(f.d, addDays(last, -14)) },
  { key: "1M", label: "1 month", base: (f, last) => idxAtOrBefore(f.d, addMonths(last, -1)) },
  { key: "3M", label: "3 months", base: (f, last) => idxAtOrBefore(f.d, addMonths(last, -3)) },
  { key: "6M", label: "6 months", base: (f, last) => idxAtOrBefore(f.d, addMonths(last, -6)) },
  { key: "1Y", label: "1 year", base: (f, last) => idxAtOrBefore(f.d, addMonths(last, -12)) },
];

/** Base point for "since Jan 2022": last NAV on/before 1 Jan 2022, else the launch NAV. */
function sinceStart(f) {
  if (!f.d.length) return null;
  const i = idxAtOrBefore(f.d, SINCE);
  const bi = i >= 0 ? i : 0;
  return { i: bi, date: f.d[bi], nav: f.v[bi], launched: i < 0 };
}

function computeMetrics(f) {
  const n = f.d.length;
  if (n === 0) return null;
  const last = f.d[n - 1], lastNav = f.v[n - 1];
  const ret = {};
  for (const w of WINDOWS) {
    const bi = w.base(f, last);
    ret[w.key] = bi >= 0 && bi < n - 1 ? lastNav / f.v[bi] - 1 : null;
  }
  const s = sinceStart(f);
  let since = null, sinceAnn = null, growth = null, maxDD = null, ddPeak = null, ddTrough = null;
  if (s && s.i < n - 1) {
    since = lastNav / s.nav - 1;
    const yrs = daysBetween(s.date, last) / 365.25;
    sinceAnn = yrs >= 1 ? Math.pow(1 + since, 1 / yrs) - 1 : null;
    growth = 10000 * (1 + since);
    let peak = s.nav, peakD = s.date, worst = 0;
    for (let k = s.i; k < n; k++) {
      if (f.v[k] > peak) { peak = f.v[k]; peakD = f.d[k]; }
      const dd = f.v[k] / peak - 1;
      if (dd < worst) { worst = dd; ddPeak = peakD; ddTrough = f.d[k]; }
    }
    maxDD = worst;
  }
  const ageDays = daysBetween(last, toISO(Date.now()));
  return { last, lastNav, ret, since, sinceAnn, sinceBase: s, growth, maxDD, ddPeak, ddTrough, stale: ageDays > 4, points: n };
}

const GRANS = [
  { key: "D", label: "Daily", noun: "day" },
  { key: "W", label: "Weekly", noun: "week" },
  { key: "F", label: "Fortnightly", noun: "fortnight" },
  { key: "M", label: "Monthly", noun: "month" },
  { key: "Q", label: "Quarterly", noun: "quarter" },
  { key: "H", label: "Half-yearly", noun: "half-year" },
  { key: "Y", label: "Yearly", noun: "year" },
];
const FORTNIGHT_ANCHOR = toTs("2022-01-03"); // a Monday

function bucketOf(s, g) {
  const y = s.slice(0, 4), m = +s.slice(5, 7);
  switch (g) {
    case "D": return { key: s, label: fmtDate(s) };
    case "W": {
      const t = toTs(s), dow = (new Date(t).getUTCDay() + 6) % 7, mon = toISO(t - dow * DAY);
      return { key: mon, label: `Week of ${fmtDate(mon)}` };
    }
    case "F": {
      const k = Math.floor((toTs(s) - FORTNIGHT_ANCHOR) / (14 * DAY)), st = toISO(FORTNIGHT_ANCHOR + k * 14 * DAY);
      return { key: st, label: `${fmtDate(st)} – ${fmtDate(addDays(st, 13))}` };
    }
    case "M": return { key: s.slice(0, 7), label: fmtMonth(s) };
    case "Q": { const q = Math.ceil(m / 3); return { key: `${y}-Q${q}`, label: `Q${q} ${y} (${MONTHS[(q - 1) * 3]}–${MONTHS[q * 3 - 1]})` }; }
    case "H": { const h = m <= 6 ? 1 : 2; return { key: `${y}-H${h}`, label: `${h === 1 ? "Jan–Jun" : "Jul–Dec"} ${y}` }; }
    default: return { key: y, label: y };
  }
}

/** Period-by-period returns since Jan 2022 (or launch): each period's closing
 *  NAV vs the previous period's closing NAV. The newest period is "to date". */
function periodReturns(f, g) {
  const s = sinceStart(f);
  if (!s || s.i >= f.d.length - 1) return [];
  const out = [];
  let prevClose = s.nav, cur = null;
  for (let k = s.i + 1; k < f.d.length; k++) {
    const b = bucketOf(f.d[k], g);
    if (!cur || cur.key !== b.key) {
      if (cur) { cur.r = cur.close / prevClose - 1; prevClose = cur.close; out.push(cur); }
      cur = { key: b.key, label: b.label, open: prevClose, close: f.v[k] };
    } else cur.close = f.v[k];
  }
  if (cur) { cur.r = cur.close / prevClose - 1; cur.partial = g !== "D"; out.push(cur); }
  return out;
}

// ---------- tooltip ----------
const tip = document.getElementById("tooltip");
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect(), pad = 12;
  let left = x + pad, top = y - r.height - pad;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
  if (left < 8) left = 8;
  if (top < 8) top = y + pad;
  tip.style.left = left + "px"; tip.style.top = top + "px";
}
const hideTip = () => { tip.hidden = true; };

// ---------- svg helpers ----------
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => span / st <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}
/** Bar path: 4px rounded data-end, square at the baseline. */
function barPath(x, w, y0, y1) {
  const h = Math.abs(y1 - y0), r = Math.min(4, w / 2, h);
  if (h < 0.5) return `M${x},${y0}h${w}`;
  return y1 < y0
    ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
    : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}
/** Fresh chart container (drops old listeners/observers) that re-renders on width change. */
function mountChart(id, render) {
  const old = document.getElementById(id), node = old.cloneNode(false);
  old.replaceWith(node);
  let w = 0;
  new ResizeObserver(() => { const nw = node.clientWidth; if (nw && nw !== w) { w = nw; node.innerHTML = ""; render(node, nw); } }).observe(node);
  return node;
}
function bindTip(target, html) {
  target.addEventListener("pointermove", (ev) => showTip(html, ev.clientX, ev.clientY));
  target.addEventListener("pointerdown", (ev) => showTip(html, ev.clientX, ev.clientY));
  target.addEventListener("pointerleave", hideTip);
}

// ---------- charts ----------
function lineChart(node, W, d, v) {
  const m = { t: 12, r: 12, b: 26, l: 56 }, H = 280, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": `NAV from ${fmtDate(d[0])} to ${fmtDate(d[d.length - 1])}` }, node);
  const t0 = toTs(d[0]), t1 = toTs(d[d.length - 1]);
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.08 || hi * 0.02; lo -= pad; hi += pad;
  const yt = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);
  const X = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * iw, Y = (val) => m.t + (1 - (val - lo) / (hi - lo)) * ih;
  for (const tv of yt) {
    el("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv) }, svg);
    el("text", { x: m.l - 8, y: Y(tv) + 4, "text-anchor": "end" }, svg).textContent = "₹" + tv.toLocaleString("en-IN");
  }
  el("line", { class: "base", x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, svg);
  const nx = Math.max(2, Math.min(6, Math.floor(iw / 110))), spanDays = (t1 - t0) / DAY;
  for (let k = 0; k <= nx; k++) {
    const t = t0 + ((t1 - t0) * k) / nx, s = toISO(t);
    const lbl = spanDays > 400 ? fmtMonth(s) : spanDays > 60 ? fmtDate(s).replace(/ (\d{2})(\d{2})$/, " '$2") : fmtDate(s).replace(/ \d{4}$/, "");
    el("text", { x: X(t), y: H - 6, "text-anchor": k === 0 ? "start" : k === nx ? "end" : "middle" }, svg).textContent = lbl;
  }
  let path = "";
  d.forEach((s, i) => { path += (i ? "L" : "M") + X(toTs(s)).toFixed(1) + "," + Y(v[i]).toFixed(1); });
  el("path", { class: "area", d: `${path}L${X(t1).toFixed(1)},${m.t + ih}L${X(t0).toFixed(1)},${m.t + ih}Z` }, svg);
  el("path", { class: "line", d: path }, svg);
  const cross = el("line", { class: "cross", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
  const dot = el("circle", { class: "marker", r: 5, visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
  const move = (ev) => {
    const rect = svg.getBoundingClientRect(), px = ((ev.clientX - rect.left) / rect.width) * W;
    const t = Math.max(t0, Math.min(t1, t0 + ((px - m.l) / iw) * (t1 - t0)));
    let i = Math.max(0, idxAtOrBefore(d, toISO(t)));
    if (i < d.length - 1 && Math.abs(toTs(d[i + 1]) - t) < Math.abs(toTs(d[i]) - t)) i++;
    const x = X(toTs(d[i])), y = Y(v[i]);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", "visible");
    showTip(`<div class="t">${fmtDate(d[i])}</div><div><strong>${fmtNav(v[i])}</strong></div><div class="t">${pctSpan(v[i] / v[0] - 1)} since ${fmtDate(d[0])}</div>`, ev.clientX, ev.clientY);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); hideTip(); });
}

function sparkline(d, v) {
  const W = 110, H = 30;
  if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), t0 = toTs(d[0]), t1 = toTs(d[d.length - 1]);
  const pts = v.map((val, i) => `${(((toTs(d[i]) - t0) / (t1 - t0 || 1)) * (W - 4) + 2).toFixed(1)},${(H - 3 - ((val - lo) / (hi - lo || 1)) * (H - 6)).toFixed(1)}`);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="var(--series-1)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/** Vertical diverging bars (gain = blue, loss = red) for period returns. */
function periodBarChart(node, W, rows, noun) {
  const H = 240, m = { t: 12, r: 8, b: 26, l: 48 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": `Gain or loss per ${noun}` }, node);
  const yt = niceTicks(Math.min(0, ...rows.map((r) => r.r)), Math.max(0, ...rows.map((r) => r.r)), 4);
  const lo = yt[0], hi = yt[yt.length - 1];
  const Y = (r) => m.t + (1 - (r - lo) / (hi - lo || 1)) * ih;
  const dp = hi - lo < 0.05 ? 1 : 0;
  for (const tv of yt) {
    el("line", { class: tv === 0 ? "base" : "gridline", x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv) }, svg);
    el("text", { x: m.l - 8, y: Y(tv) + 4, "text-anchor": "end" }, svg).textContent = fmtPct(tv, dp).replace("+", "");
  }
  const n = rows.length, slot = iw / n, gap = slot > 6 ? 2 : slot > 3 ? 1 : 0, bw = Math.max(1, slot - gap);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));
  const short = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) ? fmtDate(k).replace(/ (\d{2})(\d{2})$/, " '$2")
    : /^\d{4}-\d{2}$/.test(k) ? fmtMonth(k + "-01").replace(/ (\d{2})(\d{2})$/, " '$2") : k.replace("-", " ");
  rows.forEach((r, i) => {
    const x = m.l + i * slot + gap / 2;
    el("path", { class: r.r >= 0 ? "b-pos" : "b-neg", d: barPath(x, bw, Y(0), Y(r.r)) }, svg);
    const hit = el("rect", { class: "hit", x: m.l + i * slot, y: m.t, width: slot, height: ih }, svg);
    bindTip(hit, `<div class="t">${esc(r.label)}${r.partial ? " · to date" : ""}</div><div>${pctSpan(r.r, 2)}</div><div class="t">NAV ${fmtNav(r.open)} → ${fmtNav(r.close)}</div>`);
    if (i % every === 0) el("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" }, svg).textContent = short(r.key);
  });
}

// ---------- app state ----------
let DATA = null;
const state = { overviewWindow: "1Y", typeFilter: "All", sort: { key: "1Y", dir: -1 }, navRange: "S22", gran: "M" };
const fundType = (f) => f.portfolio?.type || "—";
function setPressed(group, value) {
  group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
}
function seg(options, value, aria) {
  return `<div class="seg" role="group" aria-label="${esc(aria)}">${options.map((o) => `<button type="button" data-v="${esc(o.v)}" aria-pressed="${o.v === value}">${esc(o.l)}</button>`).join("")}</div>`;
}
function onSeg(id, fn) {
  const g = document.getElementById(id);
  g.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setPressed(g, b.dataset.v); fn(b.dataset.v); });
}
const NEEDS = `<span class="badge"><span class="dot"></span>Needs data</span>`;

// ---------- overview ----------
const COLS = [...WINDOWS.map((w) => ({ key: w.key, label: w.key })), { key: "S22", label: "Since Jan '22" }, { key: "S22A", label: "Per year" }];
function metricFor(f, key) {
  const m = f.m; if (!m) return null;
  if (key === "S22") return m.since;
  if (key === "S22A") return m.sinceAnn;
  return m.ret[key];
}

function renderOverview() {
  const funds = DATA.funds;
  const withData = funds.filter((f) => f.m && f.m.points > 1);
  const needs = funds.filter((f) => !f.m || f.m.points < 2);
  const old = withData.filter((f) => f.m.stale);
  const latest = withData.map((f) => f.m.last).sort().pop();
  const types = ["All", ...[...new Set(funds.map(fundType))].filter((t) => t !== "—").sort()];
  const app = document.getElementById("app");
  app.innerHTML = `
    <h1>How are my funds doing?</h1>
    <p class="lede">Daily unit prices (NAV) and returns for ${funds.length} Tata AIA Life ULIP funds since January 2022, plus what each fund holds. When the NAV rises, every unit you own is worth more.${latest ? ` Latest price: <strong>${fmtDate(latest)}</strong>.` : ""}</p>
    ${needs.length || old.length ? `<div class="notice"><span class="icon" aria-hidden="true">!</span><div>
      ${needs.length ? `<strong>${needs.length} of ${funds.length} funds have no price history yet</strong> and are marked ${NEEDS}. Their holdings are still shown. ` : ""}
      ${old.length ? `<strong>${old.length} fund${old.length > 1 ? "s have" : " has"} out-of-date prices.</strong>` : ""}</div></div>` : ""}
    <section class="card">
      <div class="card-head">
        <div><h2>Which funds did best?</h2><p class="muted small">Change in NAV over the chosen period, up to each fund's latest price. Click a fund for details.</p></div>
        ${seg([...WINDOWS.map((w) => ({ v: w.key, l: w.key })), { v: "S22", l: "Since '22" }], state.overviewWindow, "Period").replace('class="seg"', 'class="seg" id="win-seg"')}
      </div>
      <div id="cmp" class="cmp"></div>
    </section>
    <section class="card">
      <div class="card-head">
        <div><h2>All funds at a glance</h2><p class="muted small">Click a column to sort. "Per year" is the average yearly growth since Jan 2022 (or since launch for newer funds).</p></div>
        ${seg(types.map((t) => ({ v: t, l: t })), state.typeFilter, "Fund type").replace('class="seg"', 'class="seg" id="type-seg"')}
      </div>
      <div class="table-scroll"><table id="ov-table"></table></div>
    </section>`;

  const drawCmp = () => {
    const key = state.overviewWindow;
    const rows = funds.map((f) => ({ f, r: f.m && f.m.points > 1 ? metricFor(f, key) : null }))
      .sort((a, b) => (b.r ?? -Infinity) - (a.r ?? -Infinity) || a.f.name.localeCompare(b.f.name));
    const vals = rows.map((x) => x.r).filter((x) => x != null);
    const maxAbs = Math.max(0.0001, ...vals.map(Math.abs));
    const hasNeg = vals.some((x) => x < 0), hasPos = vals.some((x) => x > 0);
    const zero = hasNeg && hasPos ? 50 : hasNeg ? 100 : 0, span = hasNeg && hasPos ? 50 : 100;
    document.getElementById("cmp").innerHTML = rows.map(({ f, r }) => {
      if (r == null) return `<div class="cmp-row nodata" data-code="${esc(f.code)}" role="link" tabindex="0"><span class="name">${esc(f.name)}</span><span class="cmp-track">${f.m && f.m.points > 1 ? `<span class="muted small">Too new for this period</span>` : NEEDS}</span><span class="val">—</span></div>`;
      const w = (Math.abs(r) / maxAbs) * span, left = r >= 0 ? zero : zero - w;
      return `<div class="cmp-row" data-code="${esc(f.code)}" role="link" tabindex="0" title="${esc(f.name)}: ${fmtPct(r, 2)}">
        <span class="name">${esc(f.name)}</span>
        <span class="cmp-track"><span class="zero" style="left:${zero}%"></span><span class="bar ${r >= 0 ? "pos" : "neg"}" style="left:${left}%;width:${Math.max(w, 0.4)}%"></span></span>
        <span class="val ${cls(r)}">${fmtPct(r)}</span></div>`;
    }).join("");
  };

  const drawTable = () => {
    const { key, dir } = state.sort;
    const list = funds.filter((f) => state.typeFilter === "All" || fundType(f) === state.typeFilter);
    const val = (f) => key === "nav" ? f.m?.lastNav ?? null : f.m && f.m.points > 1 ? metricFor(f, key) : null;
    list.sort((a, b) => {
      if (key === "name") return dir * a.name.localeCompare(b.name);
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir * (va - vb);
    });
    const th = (k, l) => `<th class="sortable" data-k="${k}" scope="col" ${key === k ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${l}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    document.getElementById("ov-table").innerHTML = `
      <thead><tr>${th("name", "Fund")}${th("nav", "Latest NAV")}${COLS.map((c) => th(c.key, c.label)).join("")}<th scope="col">Last 12 months</th></tr></thead>
      <tbody>${list.map((f) => {
        const m = f.m, has = m && m.points > 1;
        const meta = `${esc(fundType(f))}${f.portfolio?.risk ? " · " + esc(f.portfolio.risk) + " risk" : ""}`;
        const navCell = m ? `${fmtNav(m.lastNav)}<span class="fund-meta">${fmtDate(m.last)}${m.stale ? " · old" : ""}</span>` : "—";
        let spark = "";
        if (has) { const i = Math.max(0, idxAtOrBefore(f.d, addMonths(m.last, -12))); spark = sparkline(f.d.slice(i), f.v.slice(i)); }
        const cells = has ? COLS.map((c) => `<td class="num">${pctSpan(metricFor(f, c.key))}</td>`).join("")
          : `<td colspan="${COLS.length}" style="text-align:left">${NEEDS}</td>`;
        return `<tr class="clickable" data-code="${esc(f.code)}">
          <td><a class="fund-name" href="#/fund/${esc(f.code)}">${esc(f.name)}</a><span class="fund-meta">${meta}</span></td>
          <td class="num">${navCell}</td>${cells}<td class="spark-cell">${spark}</td></tr>`;
      }).join("")}</tbody>`;
  };

  drawCmp(); drawTable();
  onSeg("win-seg", (v) => { state.overviewWindow = v; drawCmp(); });
  onSeg("type-seg", (v) => { state.typeFilter = v; drawTable(); });
  document.getElementById("ov-table").addEventListener("click", (e) => {
    const h = e.target.closest("th.sortable");
    if (h) { const k = h.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === "name" ? 1 : -1 }; drawTable(); return; }
    const tr = e.target.closest("tr[data-code]");
    if (tr && !e.target.closest("a")) location.hash = `#/fund/${tr.dataset.code}`;
  });
  const cmp = document.getElementById("cmp");
  cmp.addEventListener("click", (e) => { const r = e.target.closest("[data-code]"); if (r) location.hash = `#/fund/${r.dataset.code}`; });
  cmp.addEventListener("keydown", (e) => { const r = e.target.closest("[data-code]"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = `#/fund/${r.dataset.code}`; } });
}

// ---------- fund detail ----------
const RANGES = [
  { v: "1M", l: "1M", from: (last) => addMonths(last, -1) },
  { v: "3M", l: "3M", from: (last) => addMonths(last, -3) },
  { v: "6M", l: "6M", from: (last) => addMonths(last, -6) },
  { v: "1Y", l: "1Y", from: (last) => addMonths(last, -12) },
  { v: "3Y", l: "3Y", from: (last) => addMonths(last, -36) },
  { v: "S22", l: "Since Jan '22", from: () => SINCE },
  { v: "ALL", l: "All", from: () => "0000-00-00" },
];

function hbars(items) {
  const top = Math.max(...items.map((i) => i.pct || 0), 0.0001);
  return `<div class="hbars">${items.map((i) => `
    <div class="hbar" title="${esc(i.name)}: ${(i.pct ?? 0).toFixed(2)}%">
      <span class="name">${esc(i.name)}</span><span class="val">${(i.pct ?? 0).toFixed(1)}%</span>
      <span class="track"><span class="fill" style="display:block;width:${((i.pct || 0) / top) * 100}%"></span></span>
    </div>`).join("")}</div>`;
}

function renderPortfolio(f) {
  const p = f.portfolio;
  if (!p) return `<section class="card"><h2>What the fund invests in</h2><p class="muted">No fact-sheet data published for this fund yet.</p></section>`;
  const mixParts = [
    { k: "Shares (equity)", v: p.asset_mix.equity_pct, c: "var(--series-1)" },
    { k: "Bonds (debt)", v: p.asset_mix.debt_pct, c: "var(--series-2)" },
    { k: "Cash & money market", v: p.asset_mix.mmi_others_pct, c: "var(--series-3)" },
  ].filter((x) => x.v);
  const periods = [["1_month", "1 month"], ["3_months", "3 months"], ["6_months", "6 months"], ["1_year", "1 year"], ["2_years", "2 years"], ["3_years", "3 years"], ["5_years", "5 years"], ["since_inception", "Since launch"]];
  const bm = p.benchmark_returns || {}, fr = p.returns || {};
  const retRows = periods.filter(([k]) => fr[k]?.change_pct != null).map(([k, l]) => {
    const a = fr[k].change_pct / 100, b = bm[k]?.change_pct != null ? bm[k].change_pct / 100 : null;
    const diff = b == null ? null : a - b;
    return `<tr><td>${l}</td><td class="num">${pctSpan(a)}</td><td class="num">${b == null ? "—" : pctSpan(b)}</td><td class="num">${diff == null ? "—" : `<span class="${cls(diff)}">${diff >= 0 ? "Ahead" : "Behind"} by ${Math.abs(diff * 100).toFixed(1)} pts</span>`}</td></tr>`;
  }).join("");
  const sectors = (p.sectors || []).filter((s) => s.name !== "Others");
  const others = (p.sectors || []).find((s) => s.name === "Others");
  const holdingsTotal = (p.holdings || []).reduce((a, h) => a + (h.pct || 0), 0);
  return `
    <h2 style="margin:24px 0 4px">What the fund invests in</h2>
    <p class="muted small" style="margin:0 0 14px">From the insurer's fact sheet for ${fmtYYYYMM(p.month)}. Holdings change month to month; the insurer publishes the top 10 positions.</p>
    <section class="card">
      <h3>Where the money goes</h3>
      <div class="mix" role="img" aria-label="${esc(mixParts.map((x) => `${x.k} ${x.v.toFixed(1)}%`).join(", "))}">${mixParts.map((x) => `<div style="width:${x.v}%;background:${x.c}" title="${esc(x.k)}: ${x.v.toFixed(1)}%"></div>`).join("")}</div>
      <div class="legend">${mixParts.map((x) => `<span><span class="sw" style="background:${x.c}"></span>${esc(x.k)} <strong class="tnum">${x.v.toFixed(1)}%</strong></span>`).join("")}</div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h3>Top 10 holdings</h3>
        <p class="muted small" style="margin:-4px 0 12px">Together ${holdingsTotal.toFixed(1)}% of the fund.</p>
        ${p.holdings?.length ? hbars(p.holdings) : `<p class="muted">Not published.</p>`}
      </section>
      <section class="card">
        <h3>Top sectors</h3>
        <p class="muted small" style="margin:-4px 0 12px">${others ? `All other sectors: ${others.pct.toFixed(1)}%.` : "&nbsp;"}</p>
        ${sectors.length ? hbars(sectors) : `<p class="muted">Not published.</p>`}
      </section>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <section class="card">
        <h3>Fund vs its benchmark</h3>
        <p class="muted small" style="margin:-4px 0 10px">Official returns to the end of ${fmtYYYYMM(p.month)}, compared with ${esc(p.benchmark || "its benchmark index")}.</p>
        ${retRows ? `<div class="table-scroll"><table><thead><tr><th>Period</th><th>Fund</th><th>Benchmark</th><th>Difference</th></tr></thead><tbody>${retRows}</tbody></table></div>` : `<p class="muted">Not published.</p>`}
      </section>
      <section class="card">
        <h3>Fund facts</h3>
        <dl class="facts">
          <dt>Type</dt><dd>${esc(p.type || "—")}</dd>
          <dt>Risk level</dt><dd>${esc(p.risk || "—")}</dd>
          <dt>Fund size</dt><dd class="tnum">${p.aum_cr ? "₹" + Math.round(p.aum_cr).toLocaleString("en-IN") + " crore" : "—"}</dd>
          <dt>Fund manager</dt><dd>${esc(p.manager || "—")}</dd>
          <dt>Fund code</dt><dd>${esc(f.sfin)}</dd>
        </dl>
        ${p.objective ? `<details><summary>What is this fund trying to do?</summary><p class="small">${esc(p.objective.replace(/\?s\b/g, "'s"))}</p></details>` : ""}
      </section>
    </div>`;
}

function renderFund(code) {
  const f = DATA.funds.find((x) => x.code === code);
  const app = document.getElementById("app");
  if (!f) { app.innerHTML = `<a class="back" href="#/">← All funds</a><p>Fund not found.</p>`; return; }
  const m = f.m, p = f.portfolio;
  const chips = [p?.type, p?.risk && `${p.risk} risk`, p?.benchmark && `Benchmark: ${p.benchmark}`].filter(Boolean);
  let html = `<a class="back" href="#/">← All funds</a>
    <h1 class="fund-title">${esc(f.name)}</h1>
    <div class="chips">${chips.map((c) => `<span class="badge">${esc(c)}</span>`).join("")}</div>`;

  if (!m || m.points < 2) {
    html += `<div class="notice"><span class="icon" aria-hidden="true">!</span><div><strong>No price history for this fund yet.</strong> ${m ? `Only one NAV is on file: ${fmtNav(m.lastNav)} on ${fmtDate(m.last)}.` : ""} Returns appear once its NAV history is added.</div></div>`;
    app.innerHTML = html + renderPortfolio(f);
    return;
  }

  const s = m.sinceBase;
  const sinceLbl = s.launched ? `since launch (${fmtDate(s.date)})` : `since ${fmtDate(s.date)}`;
  if (m.stale) html += `<div class="notice"><span class="icon" aria-hidden="true">!</span><div><strong>Prices are out of date.</strong> The latest NAV on file is from ${fmtDate(m.last)}.</div></div>`;
  html += `
    <div class="tiles">
      <div class="tile"><div class="label">Latest NAV</div><div class="value">${fmtNav(m.lastNav)}</div><div class="sub">${fmtDate(m.last)}</div></div>
      <div class="tile"><div class="label">Last day</div><div class="value">${pctSpan(m.ret["1D"], 2)}</div><div class="sub">vs the previous price</div></div>
      <div class="tile"><div class="label">₹10,000 invested ${sinceLbl}</div><div class="value">${m.growth ? fmtINR(m.growth) : "—"}</div><div class="sub">${pctSpan(m.since)} total${m.sinceAnn != null ? ` · ${fmtPct(m.sinceAnn)} a year` : ""}</div></div>
      <div class="tile"><div class="label">Biggest drop from a high</div><div class="value">${m.maxDD != null ? `<span class="${m.maxDD < 0 ? "down" : "flat"}">${fmtPct(m.maxDD)}</span>` : "—"}</div><div class="sub">${m.ddTrough ? `${fmtDate(m.ddPeak)} → ${fmtDate(m.ddTrough)}` : "No drop"}</div></div>
    </div>
    <section class="card">
      <div class="card-head">
        <div><h2>NAV over time</h2><p class="muted small" id="range-note"></p></div>
        ${seg(RANGES.map((r) => ({ v: r.v, l: r.l })), state.navRange, "Chart range").replace('class="seg"', 'class="seg" id="range-seg"')}
      </div>
      <div class="chart" id="nav-chart"></div>
    </section>
    <section class="card">
      <h2>Returns up to ${fmtDate(m.last)}</h2>
      <p class="muted small" style="margin:0 0 12px">How much the NAV changed over each period ending on the latest price.</p>
      <div class="returns">
        ${WINDOWS.map((w) => `<div class="ret"><div class="p">${w.label}</div><div class="r">${pctSpan(m.ret[w.key])}</div><div class="a">&nbsp;</div></div>`).join("")}
        <div class="ret"><div class="p">${s.launched ? "Since launch" : "Since Jan '22"}</div><div class="r">${pctSpan(m.since)}</div><div class="a">${m.sinceAnn != null ? fmtPct(m.sinceAnn) + " a year" : "&nbsp;"}</div></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head">
        <div><h2>Gain or loss in each period</h2><p class="muted small">${cap(sinceLbl)}. Blue bars are gains, red bars are losses. Hover or tap a bar for details.</p></div>
        ${seg(GRANS.map((g) => ({ v: g.key, l: g.label })), state.gran, "Period length").replace('class="seg"', 'class="seg" id="gran-seg"')}
      </div>
      <div class="tiles" id="gran-stats" style="margin-bottom:12px"></div>
      <div class="chart" id="gran-chart"></div>
      <p class="muted small" id="gran-note" style="margin:6px 0 0"></p>
      <details><summary>Show as a table</summary><div class="table-scroll" style="margin-top:8px"><table id="gran-table"></table></div></details>
    </section>`;
  app.innerHTML = html + renderPortfolio(f);

  const drawNav = () => {
    const r = RANGES.find((x) => x.v === state.navRange);
    let i = Math.max(0, idxAtOrBefore(f.d, r.from(m.last)));
    if (i >= f.d.length - 1) i = 0;
    const d = f.d.slice(i), v = f.v.slice(i);
    document.getElementById("range-note").innerHTML = `${fmtDate(d[0])} → ${fmtDate(d[d.length - 1])}: ${pctSpan(v[v.length - 1] / v[0] - 1)}`;
    mountChart("nav-chart", (node, W) => lineChart(node, W, d, v));
  };
  const drawGran = () => {
    const g = GRANS.find((x) => x.key === state.gran);
    const rows = periodReturns(f, g.key);
    const complete = rows.filter((r) => !r.partial);
    const basis = complete.length ? complete : rows;
    const statsEl = document.getElementById("gran-stats");
    if (basis.length) {
      const pos = basis.filter((r) => r.r > 0).length;
      const best = basis.reduce((a, b) => (b.r > a.r ? b : a));
      const worst = basis.reduce((a, b) => (b.r < a.r ? b : a));
      const avg = basis.reduce((a, b) => a + b.r, 0) / basis.length;
      statsEl.innerHTML = `
        <div class="tile"><div class="label">${cap(g.noun)}s with a gain</div><div class="value">${pos} of ${basis.length}</div><div class="sub">${Math.round((pos / basis.length) * 100)}% of the time</div></div>
        <div class="tile"><div class="label">Average ${g.noun}</div><div class="value">${pctSpan(avg, 2)}</div><div class="sub">${complete.length ? `complete ${g.noun}s only` : "so far"}</div></div>
        <div class="tile"><div class="label">Best ${g.noun}</div><div class="value">${pctSpan(best.r)}</div><div class="sub">${esc(best.label)}</div></div>
        <div class="tile"><div class="label">Worst ${g.noun}</div><div class="value">${pctSpan(worst.r)}</div><div class="sub">${esc(worst.label)}</div></div>`;
    } else statsEl.innerHTML = "";
    const shown = g.key === "D" && rows.length > 90 ? rows.slice(-90) : rows;
    document.getElementById("gran-note").textContent = shown.length < rows.length
      ? `Chart shows the last ${shown.length} trading days; the table lists all ${rows.length}.` : "";
    mountChart("gran-chart", (node, W) => { if (shown.length) periodBarChart(node, W, shown, g.noun); });
    document.getElementById("gran-table").innerHTML = `<thead><tr><th>${cap(g.noun)}</th><th>Start NAV</th><th>End NAV</th><th>Gain / loss</th></tr></thead>
      <tbody>${[...rows].reverse().map((r) => `<tr><td>${esc(r.label)}${r.partial ? ' <span class="muted small">(to date)</span>' : ""}</td><td class="num">${fmtNav(r.open)}</td><td class="num">${fmtNav(r.close)}</td><td class="num">${pctSpan(r.r, 2)}</td></tr>`).join("")}</tbody>`;
  };
  drawNav(); drawGran();
  onSeg("range-seg", (v) => { state.navRange = v; drawNav(); });
  onSeg("gran-seg", (v) => { state.gran = v; drawGran(); });
}

// ---------- router & boot ----------
function route() {
  hideTip();
  const mt = location.hash.match(/^#\/fund\/([A-Z0-9]+)/);
  if (mt) renderFund(mt[1]); else renderOverview();
}

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* storage unavailable */ }
  btn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (_) { /* ignore */ }
  });
}

async function boot() {
  initTheme();
  try {
    const res = await fetch("data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.getElementById("app").innerHTML = `<p class="empty">Could not load fund data (${esc(err.message)}).</p>`;
    return;
  }
  for (const f of DATA.funds) f.m = computeMetrics(f);
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
  route();
}
boot();
