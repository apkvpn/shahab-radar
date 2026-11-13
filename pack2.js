/* ============================================================================
   Shahab Radar — market directory + layout pack.
   Loads after pack.js. Adds a searchable directory of every USDT market the
   exchange lists, keeps the chart on top of the signal list, and remembers
   what you looked at.
   ============================================================================ */
const R2 = window.__radar;
if (!R2) throw new Error("radar core missing");
const ST2 = R2.state;
const $2 = id => document.getElementById(id);
const N2 = v => (Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");
const P2 = v => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const tp2 = s => ((s.tp / s.entry) - 1) * 100;

/* ---------------- chart first ---------------- */
(function chartFirst() {
  const main = document.querySelector("main");
  const chart = document.querySelector(".chart-card");
  const sig = $2("signals-sec");
  if (main && chart && sig) main.insertBefore(chart, sig);
  const pulse = $2("pulse");
  if (main && pulse) main.appendChild(pulse);
})();

/* ---------------- small toast ---------------- */
function say(msg) {
  const t = $2("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(say._t);
  say._t = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------------- settings ---------------- */
const MK = "shahab-radar-market-v1", RC = "shahab-radar-recent-v1";
const MK_DEF = { sort: "rank", dir: 1, filter: "all", q: "", limit: 120 };
let mk = { ...MK_DEF };
try { Object.assign(mk, JSON.parse(localStorage.getItem(MK) || "{}")); } catch {}
const saveMk = () => { try { localStorage.setItem(MK, JSON.stringify(mk)); } catch {} };
let recent = [];
try { recent = JSON.parse(localStorage.getItem(RC) || "[]") || []; } catch { recent = []; }
const saveRecent = () => { try { localStorage.setItem(RC, JSON.stringify(recent.slice(0, 12))); } catch {} };

/* ---------------- every listed market ---------------- */
let all = null, allAt = 0;
async function loadAll() {
  if (all && Date.now() - allAt < 60_000) return all;
  try {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers", { cache: "no-store" });
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("bad");
    const seen = new Set(), out = [];
    for (const r of list) {
      const cp = String(r.currency_pair || "").toUpperCase();
      if (!cp.endsWith("_USDT")) continue;
      const base = cp.slice(0, -5);
      if (!/^[A-Z0-9]{2,15}$/.test(base) || seen.has(base)) continue;
      const price = Number(r.last ?? r.lowest_ask);
      const chg = Number(r.change_percentage);
      const vol = Number(r.quote_volume ?? r.base_volume);
      if (!(price > 0)) continue;
      seen.add(base);
      out.push({ symbol: base, price, change: Number.isFinite(chg) ? chg : null, volume: Number.isFinite(vol) ? vol : 0 });
    }
    out.sort((a, b) => b.volume - a.volume);
    all = out; allAt = Date.now();
    return out;
  } catch (e) {
    all = ST2.markets.map(m => ({ symbol: m.symbol, price: m.price, change: m.change, volume: m.volume }));
    allAt = Date.now();
    return all;
  }
}

function sigOf(sym) { return ST2.signals.find(s => s.symbol === sym) || null; }
function mkOf(sym) { return ST2.markets.find(m => m.symbol === sym) || null; }
function isStar(sym) { try { return ST2.watch.has(sym); } catch (e) { return false; } }

function combined() {
  const rows = [];
  const seen = new Set();
  for (const m of ST2.markets) {
    seen.add(m.symbol);
    rows.push({ symbol: m.symbol, price: m.price, change: m.change, volume: m.volume, rank: m.rank, scanned: true });
  }
  if (all) {
    for (const m of all) {
      if (seen.has(m.symbol)) continue;
      rows.push({ symbol: m.symbol, price: m.price, change: m.change, volume: m.volume, rank: null, scanned: false });
    }
  }
  return rows;
}

function filtered() {
  let rows = combined();
  const q = mk.q.trim().toUpperCase();
  if (q) rows = rows.filter(r => r.symbol.includes(q));
  if (mk.filter === "signal") rows = rows.filter(r => sigOf(r.symbol));
  if (mk.filter === "quiet") rows = rows.filter(r => !sigOf(r.symbol) && r.scanned);
  if (mk.filter === "tp") rows = rows.filter(r => { const s = sigOf(r.symbol); return s && s.outcome === "TP"; });
  if (mk.filter === "open") rows = rows.filter(r => { const s = sigOf(r.symbol); return s && s.outcome !== "TP"; });
  if (mk.filter === "star") rows = rows.filter(r => isStar(r.symbol));
  if (mk.filter === "recent") rows = rows.filter(r => recent.includes(r.symbol));
  if (mk.filter === "unscanned") rows = rows.filter(r => !r.scanned);
  const dir = mk.dir;
  const key = mk.sort;
  rows.sort((a, b) => {
    if (key === "signal") {
      const sa = sigOf(a.symbol), sb = sigOf(b.symbol);
      return ((sb ? tp2(sb) : -1e9) - (sa ? tp2(sa) : -1e9)) * dir;
    }
    if (key === "price") return ((a.price || 0) - (b.price || 0)) * dir;
    if (key === "change") return (((a.change ?? -1e9) - (b.change ?? -1e9))) * dir;
    if (key === "volume") return ((a.volume || 0) - (b.volume || 0)) * dir;
    if (key === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
    return (((a.rank || 1e9) - (b.rank || 1e9))) * dir;
  });
  return rows;
}

/* ---------------- directory UI ---------------- */
const CSS2 = `
  .mkt-bar{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:8px 0 10px}
  .mkt-bar .input{height:34px;flex:1 1 150px;max-width:260px}
  .mkt-stats{font-size:11px;color:var(--muted);margin:2px 0 8px}
  .mkt-head,.mkt-row{display:grid;grid-template-columns:46px minmax(88px,1fr) 90px 66px 96px 62px;gap:6px;align-items:center}
  .mkt-head{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:800;
    padding:6px 8px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(12,15,19,.98);z-index:2}
  .mkt-head button{border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:0}
  .mkt-head button:hover{color:#fff}
  .mkt-list{max-height:58vh;overflow:auto;border:1px solid var(--line);border-radius:12px}
  .mkt-row{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.05);font-size:11.5px;cursor:pointer;
    font-variant-numeric:tabular-nums;color:var(--ink-2)}
  .mkt-row:hover{background:rgba(255,255,255,.06)}
  .mkt-row .rk{color:var(--muted);font-size:10px}
  .mkt-row .sy{display:flex;align-items:center;gap:5px;font-weight:800;color:#fff;min-width:0}
  .mkt-row .sy span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mkt-row .sg{font-size:8.5px;font-weight:900;border-radius:5px;padding:1px 5px;border:1px solid var(--line);color:var(--muted)}
  .mkt-row .sg.tp{background:rgba(96,165,250,.16);border-color:rgba(96,165,250,.4);color:#bfdbfe}
  .mkt-row .sg.op{background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.35);color:#fcd34d}
  .mkt-row .up{color:#6ee7b7} .mkt-row .down{color:#fda4af}
  .mkt-row .st{color:#5b6572;border:0;background:transparent;font-size:12px;padding:0}
  .mkt-row .st.on{color:#d9ff8f}
  .mkt-row .ns{color:#5b6572;font-size:9px}
  .mkt-foot{display:flex;gap:8px;align-items:center;margin-top:9px;font-size:11px;color:var(--muted)}
  .mkt-empty{padding:18px;text-align:center;color:var(--muted);font-size:12px}
  .mkt-seg{display:inline-flex;gap:3px;padding:3px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.25);flex-wrap:wrap}
  .mkt-seg button{border:0;background:transparent;color:var(--muted);font-size:11px;font-weight:700;padding:4px 8px;border-radius:7px}
  .mkt-seg button.on{background:linear-gradient(135deg,#e2ff7a,#a3e635);color:#0a0f02}
  @media (max-width:600px){
    .mkt-head,.mkt-row{grid-template-columns:34px minmax(74px,1fr) 76px 58px 44px}
    .mkt-head span[data-c="vol"],.mkt-row .vol{display:none}
  }
`;
(function () { const s = document.createElement("style"); s.textContent = CSS2; document.head.appendChild(s); })();

const win = document.createElement("div");
win.className = "modal"; win.id = "mktModal"; win.hidden = true;
win.innerHTML = `<div class="modal-box" style="max-width:820px">
  <div class="modal-head"><h3>All markets</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn small" id="mktCsv">CSV</button>
      <button class="btn small" id="mktClose">Close</button>
    </div></div>
  <div class="mkt-bar">
    <input id="mktSearch" class="input" placeholder="Search any coin…" autocomplete="off" spellcheck="false">
    <div class="mkt-seg" id="mktFilter">
      <button data-f="all">All</button>
      <button data-f="signal">Signals</button>
      <button data-f="tp">TP</button>
      <button data-f="open">Open</button>
      <button data-f="quiet">No signal</button>
      <button data-f="star">★</button>
      <button data-f="recent">Recent</button>
    </div>
  </div>
  <div class="mkt-stats" id="mktStats">Loading markets…</div>
  <div class="mkt-head">
    <button data-s="rank">#</button>
    <button data-s="symbol">Coin</button>
    <button data-s="price">Price</button>
    <button data-s="change">24h</button>
    <button data-s="volume" data-c="vol">Volume</button>
    <button data-s="signal">TP %</button>
  </div>
  <div class="mkt-list" id="mktList"><div class="mkt-empty">Loading…</div></div>
  <div class="mkt-foot"><span id="mktMore"></span><button class="btn small" id="mktLoadMore" hidden>Show more</button></div>
</div>`;
document.body.appendChild(win);
win.querySelector("#mktClose").onclick = () => { win.hidden = true; };
win.addEventListener("click", e => { if (e.target === win) win.hidden = true; });

function renderFilters() {
  win.querySelectorAll("#mktFilter button").forEach(b => b.classList.toggle("on", b.dataset.f === mk.filter));
}
win.querySelector("#mktFilter").onclick = e => {
  const b = e.target.closest("button[data-f]");
  if (!b) return;
  mk.filter = b.dataset.f; mk.limit = 120; saveMk(); renderFilters(); renderList();
};
win.querySelector("#mktSearch").oninput = e => { mk.q = e.target.value; mk.limit = 120; renderList(); };
win.querySelector(".mkt-head").onclick = e => {
  const b = e.target.closest("button[data-s]");
  if (!b) return;
  const s = b.dataset.s;
  if (mk.sort === s) mk.dir = -mk.dir; else { mk.sort = s; mk.dir = 1; }
  mk.limit = 120; saveMk(); renderList();
};
win.querySelector("#mktLoadMore").onclick = () => { mk.limit += 200; saveMk(); renderList(); };
win.querySelector("#mktCsv").onclick = () => {
  const rows = filtered();
  const lines = ["symbol,rank,price,change_24h,volume_24h,signal,tp_pct,status"];
  for (const r of rows) {
    const s = sigOf(r.symbol);
    lines.push([r.symbol, r.rank || "", r.price ?? "", r.change ?? "", r.volume ?? "",
      s ? "1" : "0", s ? tp2(s).toFixed(2) : "", s ? s.outcome : ""].join(","));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `shahab-radar-markets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  say(`${rows.length} markets exported`);
};

function renderList() {
  const list = $2("mktList");
  if (!list) return;
  const rows = filtered();
  const shown = rows.slice(0, mk.limit);
  $2("mktStats").textContent = all
    ? `${N2(all.length)} USDT markets listed · ${N2(ST2.markets.length)} scanned · ${N2(ST2.signals.length)} with a signal`
    : `Loading the full list… showing the ${N2(ST2.markets.length)} scanned markets`;
  if (!shown.length) {
    list.innerHTML = `<div class="mkt-empty">Nothing matches this filter.</div>`;
  } else {
    list.innerHTML = shown.map(r => {
      const s = sigOf(r.symbol);
      const badge = s ? `<span class="sg ${s.outcome === "TP" ? "tp" : "op"}">${s.outcome}</span>` : (r.scanned ? "" : `<span class="ns">·</span>`);
      const chg = Number.isFinite(r.change) ? `<span class="${r.change >= 0 ? "up" : "down"}">${P2(r.change)}</span>` : "—";
      return `<div class="mkt-row" data-sym="${r.symbol}">
        <span class="rk">${r.rank ? "#" + r.rank : "—"}</span>
        <span class="sy"><span>${r.symbol}</span>${badge}</span>
        <span>${r.price ? N2(r.price) : "—"}</span>
        <span>${chg}</span>
        <span class="vol">${r.volume ? "$" + N2(r.volume) : "—"}</span>
        <span>${s ? P2(tp2(s)) : "—"}</span>
        <button class="st ${isStar(r.symbol) ? "on" : ""}" data-star="${r.symbol}" title="Watch">★</button>
      </div>`;
    }).join("");
  }
  $2("mktMore").textContent = rows.length > shown.length ? `Showing ${shown.length} of ${N2(rows.length)}` : `${N2(rows.length)} markets`;
  const more = $2("mktLoadMore");
  more.hidden = rows.length <= shown.length;
}
win.querySelector("#mktList").onclick = e => {
  const star = e.target.closest("[data-star]");
  if (star) {
    e.stopPropagation();
    const sym = star.dataset.star;
    if (isStar(sym)) ST2.watch.delete(sym); else ST2.watch.add(sym);
    try { localStorage.setItem("shahab-radar-watch-v1", JSON.stringify([...ST2.watch])); } catch (err) {}
    star.classList.toggle("on", isStar(sym));
    R2.renderSignals();
    return;
  }
  const row = e.target.closest("[data-sym]");
  if (!row) return;
  openCoin(row.dataset.sym);
};

function openCoin(sym) {
  const card = [...document.querySelectorAll("#signals .sig")].find(c => {
    const el = c.querySelector(".sym");
    return el && el.textContent.trim() === sym;
  });
  win.hidden = true;
  if (card) { card.click(); return; }
  if (mkOf(sym)) { location.href = `${location.pathname}?coin=${encodeURIComponent(sym)}`; return; }
  say(`${sym} is listed but outside the scanned top 1000 — no daily history cached for it yet.`);
}

async function openMarkets() {
  win.hidden = false;
  renderFilters();
  $2("mktSearch").value = mk.q || "";
  renderList();
  await loadAll();
  renderList();
}

/* header button */
(function button() {
  const actions = document.querySelector(".top .actions");
  if (!actions) return;
  const b = document.createElement("button");
  b.className = "btn"; b.id = "mktBtn"; b.textContent = "☰ Markets"; b.title = "Every listed coin (M)";
  b.onclick = () => openMarkets();
  actions.insertBefore(b, actions.firstChild);
})();

/* remember what you look at */
let lastSym = null;
setInterval(() => {
  const el = $2("chartSym");
  if (!el) return;
  const sym = el.textContent.trim();
  if (!sym || sym === "—" || sym === lastSym) return;
  lastSym = sym;
  recent = [sym, ...recent.filter(x => x !== sym)].slice(0, 12);
  saveRecent();
}, 1500);

/* refresh the open directory with live prices */
setInterval(() => {
  if (!win.hidden) renderList();
}, 20_000);

/* keyboard: M opens the directory */
document.addEventListener("keydown", e => {
  if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
  if (String(e.key).toLowerCase() === "m") {
    if (win.hidden) openMarkets(); else win.hidden = true;
  }
  if (e.key === "Escape") win.hidden = true;
});
