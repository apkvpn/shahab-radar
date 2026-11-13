/* ============================================================================
   Shahab Radar — extras layer (50+ additions).
   Runs next to app.js, reads the scan through window.__radar and the chart
   through the instance captured in index.html. The signal engine is untouched.
   ============================================================================ */
const R = window.__radar;
if (!R) throw new Error("radar core missing");
const ST = R.state;
const $ = id => document.getElementById(id);
const N = v => (Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—");
const P = v => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const DAYK = t => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const STAMP = t => `${DAYK(t)} ${new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
const tpPct = s => ((s.tp / s.entry) - 1) * 100;
const mkt = sym => ST.markets.find(m => m.symbol === sym);
const prog = s => {
  if (s.outcome === "TP") return 100;
  const m = mkt(s.symbol);
  const p = m && Number.isFinite(m.price) ? m.price : null;
  if (p == null || !(s.tp > s.entry)) return null;
  return Math.max(0, Math.min(100, ((p - s.entry) / (s.tp - s.entry)) * 100));
};
const CHART = () => window.__chart || null;

/* ---------------- settings ---------------- */
const KEY = "shahab-radar-pack-v1";
const DEF = { theme: "lime", dense: false, stats: true, focus: false, quiet: false, title: true, favicon: true, tpAlert: 80, tone: 0, hideTp: false, top100: false, select: false, tips: true };
let cfg = { ...DEF };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

const CSS = `
  body.dense .sig{padding:9px 10px;gap:6px;border-radius:13px}
  body.dense .grid{grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:8px;padding:12px}
  body.dense .sig-rows{font-size:10px}
  body.focus #stats,body.focus #signals-sec,body.focus footer,body.focus #pulse{display:none !important}
  body[data-theme="blue"]{--lime:#a5c8ff;--lime-2:#60a5fa;--lime-3:#3b82f6;--lime-soft:rgba(96,165,250,.14)}
  body[data-theme="violet"]{--lime:#d8b4fe;--lime-2:#a78bfa;--lime-3:#7c3aed;--lime-soft:rgba(167,139,250,.14)}
  body[data-theme="amber"]{--lime:#fde68a;--lime-2:#fbbf24;--lime-3:#d97706;--lime-soft:rgba(251,191,36,.14)}
  body[data-theme="blue"] .btn.primary,body[data-theme="blue"] .seg button.on,body[data-theme="blue"] .toolbar .tb.on,
  body[data-theme="blue"] .badge-new,body[data-theme="blue"] .toast,body[data-theme="blue"] .sig.fresh::before{background:linear-gradient(135deg,#dbeafe,#60a5fa 55%,#3b82f6);color:#04101f}
  body[data-theme="violet"] .btn.primary,body[data-theme="violet"] .seg button.on,body[data-theme="violet"] .toolbar .tb.on,
  body[data-theme="violet"] .badge-new,body[data-theme="violet"] .toast,body[data-theme="violet"] .sig.fresh::before{background:linear-gradient(135deg,#f3e8ff,#a78bfa 55%,#7c3aed);color:#180428}
  body[data-theme="amber"] .btn.primary,body[data-theme="amber"] .seg button.on,body[data-theme="amber"] .toolbar .tb.on,
  body[data-theme="amber"] .badge-new,body[data-theme="amber"] .toast,body[data-theme="amber"] .sig.fresh::before{background:linear-gradient(135deg,#fef3c7,#fbbf24 55%,#d97706);color:#1c1203}

  .pulse-grid{display:grid;gap:12px;padding:14px 18px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
  .pg{border:1px solid var(--line);border-radius:14px;padding:11px 12px;background:rgba(255,255,255,.02);
    display:flex;flex-direction:column;gap:8px;min-width:0}
  .pg h4{margin:0;font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);font-weight:800}
  .broad{display:flex;height:8px;border-radius:99px;overflow:hidden;background:rgba(255,255,255,.07)}
  .broad i{display:block;height:100%}
  .broad .u{background:linear-gradient(90deg,#059669,#34d399)}
  .broad .d{background:linear-gradient(90deg,#fb7185,#9f1239)}
  .bl{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);font-weight:700}
  .movers{display:flex;flex-wrap:wrap;gap:4px}
  .mv{display:inline-flex;gap:5px;align-items:center;border:1px solid var(--line);background:rgba(255,255,255,.04);
    color:var(--ink-2);border-radius:8px;padding:3px 7px;font-size:10.5px;font-weight:700}
  .mv:hover{border-color:rgba(255,255,255,.24);color:#fff}
  .mv b{font-variant-numeric:tabular-nums}
  .mv.up b{color:#6ee7b7} .mv.down b{color:#fda4af}
  .ring{display:flex;align-items:center;gap:12px}
  .ring .big{font-size:20px;font-weight:800;letter-spacing:-.02em}
  .ring .sub{font-size:10px;color:var(--muted)}
  .hist{display:flex;align-items:flex-end;gap:5px;height:52px}
  .hist div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:3px;text-align:center}
  .hist i{display:block;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#c8f751,#4d7c0f);min-height:3px}
  .hist span{font-size:8.5px;color:var(--muted);font-weight:700}
  .heat{display:grid;grid-template-columns:repeat(12,1fr);gap:3px}
  .heat i{display:block;aspect-ratio:1;border-radius:3px;background:rgba(255,255,255,.06)}
  .feat{display:grid;gap:3px;cursor:pointer}
  .feat .t{display:flex;align-items:center;gap:6px;font-weight:800;font-size:13px;color:#fff}
  .feat .v{font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .pf{display:grid;gap:5px;max-height:140px;overflow:auto}
  .pfrow{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--ink-2)}
  .pfrow b{font-variant-numeric:tabular-nums;color:#fff}
  .pfrow .g{margin-left:auto;font-weight:800}
  .pfrow .g.up,.pf-total .up{color:#6ee7b7}
  .pfrow .g.down,.pf-total .down{color:#fda4af}
  .pfrow button{border:0;background:transparent;color:#5b6572;font-size:11px;padding:0 2px}
  .pfrow button:hover{color:#fda4af}
  .pf-total{display:flex;justify-content:space-between;font-size:11px;font-weight:800;border-top:1px solid var(--line);padding-top:6px;gap:8px}
  .spark{width:100%;height:30px;display:block}
  .pfbtn{border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink-2);border-radius:7px;
    font-size:10px;font-weight:800;padding:1px 6px;margin-left:auto}
  .pfbtn:hover{background:var(--lime-soft);border-color:rgba(200,247,81,.4);color:#eaffb0}
  .sig .pick{position:absolute;top:8px;left:8px;width:14px;height:14px;accent-color:#a3e635;z-index:2}
  .sig .rem{color:#c8f751}

  .mini-bar{position:fixed;top:0;left:0;right:0;z-index:40;display:none;align-items:center;gap:10px;
    padding:7px 14px;background:rgba(9,11,14,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--line);
    font-size:11.5px;color:var(--ink-2)}
  .mini-bar.on{display:flex}
  .mini-bar b{color:#fff}
  .mini-bar .grow{flex:1}
  .mini-bar .track{width:90px;height:4px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
  .mini-bar .track i{display:block;height:100%;background:linear-gradient(90deg,#65a30d,#c8f751)}
  .top-btn{position:fixed;right:16px;bottom:18px;z-index:45;width:40px;height:40px;border-radius:50%;
    border:1px solid var(--line-2);background:rgba(20,24,31,.92);color:var(--ink);font-size:16px;
    box-shadow:0 14px 30px -16px rgba(0,0,0,.9);opacity:0;pointer-events:none;transition:.2s}
  .top-btn.on{opacity:1;pointer-events:auto}
  .offline{position:fixed;top:10px;left:50%;transform:translate(-50%,-80px);z-index:90;background:#7f1d1d;color:#fee2e2;
    border:1px solid #b91c1c;border-radius:10px;padding:6px 12px;font-size:11.5px;font-weight:700;transition:.25s}
  .offline.on{transform:translate(-50%,0)}
  .tip-bar{display:flex;gap:8px;align-items:center;padding:7px 18px;font-size:11px;color:var(--muted);
    border-bottom:1px solid var(--line);background:rgba(200,247,81,.04)}
  .tip-bar b{color:#d9ff8f;font-weight:700}
  .tip-bar button{margin-left:auto;border:0;background:transparent;color:var(--muted);font-size:13px}
  .dr{display:flex;flex-wrap:wrap;align-items:center;gap:7px;font-size:11.5px;padding:8px 0;border-bottom:1px solid var(--line)}
  .dr .lb{font-weight:700;color:var(--ink)}
  .dr .ds{color:var(--muted);font-size:10.5px}
  .dr .ctl{margin-left:auto;display:flex;gap:5px;align-items:center}
  .sw{width:38px;height:20px;border-radius:99px;border:1px solid var(--line-2);background:rgba(255,255,255,.08);
    position:relative;transition:.18s;flex:0 0 auto}
  .sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#8a94a4;transition:.18s}
  .sw.on{background:linear-gradient(135deg,#e2ff7a,#a3e635);border-color:rgba(200,247,81,.7)}
  .sw.on::after{left:20px;background:#0a0f02}
  .tabs{display:flex;gap:5px;flex-wrap:wrap;margin:4px 0 10px}
  .tabs button{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--muted);border-radius:9px;
    padding:5px 10px;font-size:11px;font-weight:700}
  .tabs button.on{background:linear-gradient(135deg,#e2ff7a,#a3e635);color:#0a0f02;border-color:rgba(200,247,81,.65)}
  .cmd-list{max-height:300px;overflow:auto;display:grid;gap:2px;margin-top:10px}
  .cmd-list button{display:flex;gap:8px;align-items:center;border:0;background:transparent;color:var(--ink-2);
    padding:6px 8px;border-radius:8px;font-size:12px;text-align:left}
  .cmd-list button:hover,.cmd-list button.sel{background:rgba(255,255,255,.08);color:#fff}
  .cmd-list b{margin-left:auto;font-size:10px;color:var(--muted)}
  .ohlc{font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .kbd{display:inline-block;min-width:20px;text-align:center;border:1px solid var(--line-2);border-radius:5px;
    padding:1px 5px;font-size:10.5px;font-family:ui-monospace,Menlo,monospace;color:#fff;background:rgba(255,255,255,.06)}
  .help-row{display:flex;gap:10px;align-items:center;font-size:11.5px;color:var(--ink-2);padding:5px 0}
  .bx{display:inline-flex;gap:5px;align-items:center;border-radius:6px;padding:1px 6px;font-size:10px;
    font-weight:700;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink-2)}
  .bx.good{border-color:rgba(52,211,153,.35);background:rgba(52,211,153,.12);color:#6ee7b7}
  .bx.warn{border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.12);color:#fcd34d}
  .bx.bad{border-color:rgba(251,113,133,.35);background:rgba(251,113,133,.12);color:#fda4af}
  .meter{height:4px;border-radius:99px;background:rgba(255,255,255,.09);overflow:hidden;min-width:54px;flex:1}
  .meter i{display:block;height:100%;background:linear-gradient(90deg,#60a5fa,#a3e635)}
`;
(function () { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); })();

/* ---------------- helpers ---------------- */
function ping(msg) {
  if (cfg.quiet) return;
  const t = $("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(ping._t);
  ping._t = setTimeout(() => t.classList.remove("show"), 3500);
}
function tone(strong) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ctx.currentTime;
    const notes = [[880, 1180], [660, 990], [520, 780, 1040]][cfg.tone % 3];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = strong ? "triangle" : "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.28);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + i * 0.14); o.stop(t0 + i * 0.14 + 0.3);
    });
  } catch (e) {}
}
function sysNotify(title, body) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch (e) {}
}
const rsi = (closes, n) => {
  let g = 0, l = 0;
  for (let i = Math.max(1, closes.length - n); i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (!l) return 100;
  return 100 - 100 / (1 + g / l);
};
const emaAt = (vals, n) => {
  const k = 2 / (n + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
};

/* ---------------- paper portfolio ---------------- */
const PFK = "shahab-radar-pf-v1";
let pf = [];
try { pf = JSON.parse(localStorage.getItem(PFK) || "[]") || []; } catch { pf = []; }
const savePf = () => { try { localStorage.setItem(PFK, JSON.stringify(pf)); } catch {} };
function pfAdd(sym) {
  const s = ST.signals.find(x => x.symbol === sym);
  if (!s) return;
  if (pf.some(p => p.id === s.id)) { ping(`${sym} is already in the portfolio`); return; }
  pf.push({ id: s.id, symbol: sym, entry: s.entry, tp: s.tp, t: s.candleTime, size: 100 });
  savePf(); renderPulse(true); ping(`Added ${sym} — $100 paper trade`);
}
function pfRows() {
  return pf.map(p => {
    const m = mkt(p.symbol);
    const px = m && Number.isFinite(m.price) ? m.price : p.entry;
    const gain = (px / p.entry - 1) * 100;
    return { ...p, px, gain, pnl: (gain * (p.size || 100)) / 100 };
  });
}

/* ---------------- market pulse card ---------------- */
const statsEl = $("stats");
let pulseEl = null;
if (statsEl) {
  pulseEl = document.createElement("section");
  pulseEl.className = "card";
  pulseEl.id = "pulse";
  pulseEl.innerHTML = `<div class="card-head"><h2>Market pulse</h2>
    <span class="chip lime" id="pulseChip">—</span>
    <span class="muted" id="pulseNote" style="margin-left:auto"></span></div>
    <div class="pulse-grid" id="pulseGrid"></div>`;
  statsEl.after(pulseEl);
}

let pulseAt = 0;
function renderPulse(force) {
  const box = $("pulseGrid");
  if (!box) return;
  const now = Date.now();
  if (!force && now - pulseAt < 900) return;
  pulseAt = now;

  const chg = ST.markets.filter(m => Number.isFinite(m.change));
  const up = chg.filter(m => m.change > 0).length, down = chg.filter(m => m.change < 0).length;
  const upPct = chg.length ? (up / chg.length) * 100 : 0;
  const chip = $("pulseChip");
  if (chip) chip.textContent = `${ST.markets.length} markets · ${chg.length} priced`;
  const note = $("pulseNote");
  if (note) note.textContent = ST.done ? "Full scan saved" : ST.busy ? "Scanning…" : "Ready";

  const live = ST.markets.filter(m => Number.isFinite(m.change) && m.volume > 5e5);
  const gainers = live.slice().sort((a, b) => b.change - a.change).slice(0, 5);
  const losers = live.slice().sort((a, b) => a.change - b.change).slice(0, 5);
  const mv = (m, c) => `<button class="mv ${c}" data-open="${m.symbol}">${m.symbol} <b>${P(m.change)}</b></button>`;

  const sigs = ST.signals;
  const tp = sigs.filter(s => s.outcome === "TP").length, total = sigs.length;
  const rate = total ? (tp / total) * 100 : 0;
  const circ = 2 * Math.PI * 24;
  const gains = sigs.filter(s => s.outcome === "TP").map(s => s.pnlPct || 0);
  const buckets = [[0, 10], [10, 25], [25, 50], [50, 100], [100, 1e9]];
  const labels = ["0-10", "10-25", "25-50", "50+", "100+"];
  const counts = buckets.map(([a, b]) => gains.filter(g => g >= a && g < b).length);
  const maxC = Math.max(1, ...counts);

  const months = [];
  const d0 = new Date(); d0.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    const c = sigs.filter(s => { const x = new Date(s.candleTime); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); }).length;
    months.push({ c, m: d });
  }
  const maxM = Math.max(1, ...months.map(x => x.c));

  const tps = sigs.filter(s => s.outcome === "TP");
  const avgDays = tps.length ? tps.reduce((a, s) => a + (s.days || 0), 0) / tps.length : null;
  let run = 0, best = 0;
  for (const s of sigs.slice().sort((a, b) => a.candleTime - b.candleTime)) {
    if (s.outcome === "TP") { run++; best = Math.max(best, run); } else run = 0;
  }
  const newest = sigs.slice().sort((a, b) => b.candleTime - a.candleTime)[0];

  const rows = pfRows();
  const pnl = rows.reduce((a, r) => a + r.pnl, 0);
  const invested = rows.reduce((a, r) => a + (r.size || 100), 0);
  let acc = 0;
  const pts = rows.map(r => (acc += r.gain)).map((v, i) => `${(i / Math.max(1, rows.length - 1)) * 100},${(28 - Math.max(0, Math.min(26, (v + 40) * 0.33))).toFixed(1)}`);
  const spark = rows.length > 1 ? `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
    <polyline points="${pts.join(" ")}" fill="none" stroke="${pnl >= 0 ? "#34d399" : "#fb7185"}" stroke-width="1.6"/></svg>` : "";

  box.innerHTML = `
    <div class="pg"><h4>Market breadth</h4>
      <div class="broad"><i class="u" style="width:${upPct}%"></i><i class="d" style="width:${100 - upPct}%"></i></div>
      <div class="bl"><span>${up} up</span><span>${down} down</span></div>
      <div class="movers">${gainers.slice(0, 3).map(m => mv(m, "up")).join("") || `<span class="ds">waiting for prices</span>`}</div>
    </div>
    <div class="pg"><h4>Top gainers 24h</h4>
      <div class="movers">${gainers.map(m => mv(m, "up")).join("") || `<span class="ds">waiting for prices</span>`}</div></div>
    <div class="pg"><h4>Top losers 24h</h4>
      <div class="movers">${losers.map(m => mv(m, "down")).join("") || `<span class="ds">waiting for prices</span>`}</div></div>
    <div class="pg"><h4>TP hit rate</h4>
      <div class="ring">
        <svg width="62" height="62" viewBox="0 0 62 62">
          <circle cx="31" cy="31" r="24" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="7"/>
          <circle cx="31" cy="31" r="24" fill="none" stroke="#a3e635" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="${((circ * rate) / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 31 31)"/>
        </svg>
        <div><div class="big num">${rate.toFixed(0)}%</div><div class="sub">${tp} of ${total} signals hit TP</div></div>
      </div></div>
    <div class="pg"><h4>TP gain distribution</h4>
      <div class="hist">${counts.map((c, i) => `<div><i style="height:${Math.round((c / maxC) * 40) + 3}px"></i><span>${labels[i]}</span></div>`).join("")}</div></div>
    <div class="pg"><h4>Signals per month</h4>
      <div class="heat">${months.map(x => `<i title="${x.m.toLocaleDateString("en-US", { month: "short", year: "numeric" })} · ${x.c}" style="background:rgba(163,230,53,${(0.08 + 0.75 * (x.c / maxM)).toFixed(2)})"></i>`).join("")}</div>
      <div class="bl"><span>${months[0].m.toLocaleDateString("en-US", { month: "short" })}</span><span>${months[11].m.toLocaleDateString("en-US", { month: "short" })}</span></div></div>
    <div class="pg"><h4>Signal of the day</h4>
      ${newest ? `<div class="feat" data-open="${newest.symbol}">
        <div class="t"><span>${newest.symbol}</span><span class="bx ${newest.outcome === "TP" ? "good" : "warn"}">${newest.outcome}</span></div>
        <div class="v">Entry ${N(newest.entry)} · TP ${N(newest.tp)} · ${P(tpPct(newest))}</div>
        <div class="v">${STAMP(newest.candleTime)}</div></div>`
      : `<span class="ds">No signal yet.</span>`}
      <div class="bl" style="margin-top:auto"><span>Avg days to TP</span><span>${avgDays == null ? "—" : avgDays.toFixed(1) + "d"}</span></div>
      <div class="bl"><span>Best TP streak</span><span>${best} in a row</span></div></div>
    <div class="pg"><h4>Paper portfolio</h4>
      ${rows.length ? `<div class="pf">${rows.map(r => `<div class="pfrow"><span>${r.symbol}</span><b>${N(r.px)}</b>
        <span class="g ${r.gain >= 0 ? "up" : "down"}">${P(r.gain)}</span>
        <button data-pfdel="${r.id}" title="Remove">✕</button></div>`).join("")}</div>${spark}
        <div class="pf-total"><span>${rows.length} open · $${N(invested)}</span>
        <span class="${pnl >= 0 ? "up" : "down"}">${pnl >= 0 ? "+" : ""}$${N(pnl)} (${P(invested ? (pnl / invested) * 100 : 0)})</span></div>`
      : `<span style="font-size:11px;color:var(--muted)">Use the ＋ button on a signal card to track a $100 paper trade.</span>
         <div class="bl" style="margin-top:auto"><span>Total P&L</span><span>—</span></div>`}
    </div>`;

  box.querySelectorAll("[data-pfdel]").forEach(b => b.onclick = () => {
    pf = pf.filter(x => x.id !== b.dataset.pfdel); savePf(); renderPulse(true);
  });
}
document.addEventListener("click", e => {
  const el = e.target.closest("[data-open]");
  if (!el) return;
  const sym = el.dataset.open;
  const card = [...document.querySelectorAll("#signals .sig")].find(c => c.querySelector(".sym") && c.querySelector(".sym").textContent.trim() === sym);
  if (card) card.click();
  else location.href = `${location.pathname}?coin=${encodeURIComponent(sym)}`;
});

/* ---------------- chart extras ---------------- */
let curSymbol = null, curCandles = [], markersCache = [], markersOn = true, bandsOn = true, cmpSeries = null, cmpSym = null;
const bandSeries = () => window.__bandSeries || [];

function chartRange(bars) {
  const c = CHART();
  if (!c || !curCandles.length) return;
  const n = curCandles.length;
  c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n + 6 - bars), to: n + 6 });
}
function zoomToSignal() {
  const c = CHART();
  if (!c || !curCandles.length) return;
  const rows = R.analyze(curCandles).signals;
  if (!rows.length) { ping("No signal on this coin"); return; }
  const t = rows[rows.length - 1].t;
  let i = curCandles.findIndex(k => k.t >= t);
  if (i < 0) i = curCandles.length - 1;
  c.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 110), to: Math.min(curCandles.length + 6, i + 60) });
}
async function compareWith(sym) {
  const c = CHART();
  if (!c) return;
  if (!sym) {
    if (cmpSeries) { try { c.removeSeries(cmpSeries); } catch (e) {} cmpSeries = null; }
    cmpSym = null;
    return;
  }
  try {
    const arr = await R.candles(sym, Math.min(1000, curCandles.length || 500), true);
    if (!arr.length) { ping(`No candles for ${sym}`); return; }
    if (!cmpSeries) {
      cmpSeries = c.addSeries(LightweightCharts.LineSeries, {
        color: "#a78bfa", lineWidth: 1, priceScaleId: "left", priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
      });
      c.priceScale("left").applyOptions({ visible: true, scaleMargins: { top: 0.16, bottom: 0.16 } });
    }
    const base = arr[0].c;
    cmpSeries.setData(arr.map(k => ({ time: Math.floor(k.t / 1000), value: (k.c / base - 1) * 100 })));
    cmpSym = sym;
    ping(`Comparing with ${sym} — left scale is % since the first candle`);
  } catch (e) { ping("Compare failed"); }
}
function chartShot() {
  const c = CHART();
  if (!c) return;
  try {
    const cv = c.takeScreenshot();
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `shahab-radar-${curSymbol || "chart"}.png`;
    a.click();
    ping("Chart image saved");
  } catch (e) { ping("Screenshot not available"); }
}
function copyLevels() {
  const s = ST.signals.find(x => x.symbol === curSymbol);
  if (!s) { ping("Open a coin with a signal first"); return; }
  const txt = `${s.symbol} — daily signal
Entry: ${N(s.entry)}
TP (midline): ${N(s.tp)} (${P(tpPct(s))})
Support: ${N(s.support)}
Date: ${new Date(s.candleTime).toISOString().slice(0, 10)}
Status: ${s.outcome === "TP" ? `TP hit in ${s.days}d (${P(s.pnlPct)})` : "open"}`;
  navigator.clipboard.writeText(txt).then(() => ping("Levels copied")).catch(() => window.prompt("Copy:", txt));
}

(function toolbar() {
  const bar = $("tools");
  if (!bar) return;
  const sep = document.createElement("span"); sep.className = "sep"; bar.appendChild(sep);
  const mk = (label, title, fn, on) => {
    const b = document.createElement("button");
    b.className = `tb${on ? " on" : ""}`; b.textContent = label; b.title = title;
    b.onclick = () => fn(b); bar.appendChild(b); return b;
  };
  mk("1M", "About one month", () => chartRange(30));
  mk("3M", "About three months", () => chartRange(92));
  mk("6M", "About six months", () => chartRange(183));
  mk("1Y", "About one year", () => chartRange(365));
  mk("ALL", "Every candle", () => chartRange(curCandles.length + 6));
  mk("BANDS", "Support / midline / resistance", b => {
    bandsOn = !bandsOn; b.classList.toggle("on", bandsOn);
    bandSeries().forEach(s => { try { s.applyOptions({ visible: bandsOn }); } catch (e) {} });
  }, true);
  mk("SIG", "Signal arrows", b => {
    markersOn = !markersOn; b.classList.toggle("on", markersOn);
    applyMarkers();
  }, true);
  mk("📍", "Zoom to the last signal", () => zoomToSignal());
  mk("CMP", "Compare with another coin", () => {
    const raw = window.prompt("Compare with coin (empty = clear):", cmpSym || "");
    if (raw === null) return;
    compareWith(raw.trim().toUpperCase() || null);
  });
  mk("📷", "Save chart as PNG", () => chartShot());
  mk("⧉", "Copy this signal's levels", () => copyLevels());
})();

function applyMarkers() {
  const api = window.__markersApi;
  if (!api) return;
  try { api.setMarkers(markersOn ? markersCache : []); } catch (e) {}
}

(function crosshair() {
  const head = document.querySelector(".chart-card .card-head");
  const c = CHART();
  if (!head || !c) return;
  const el = document.createElement("span");
  el.className = "ohlc"; el.id = "ohlc";
  head.appendChild(el);
  c.subscribeCrosshairMove(p => {
    if (!p || !p.seriesData || !window.__candleSeries) { el.textContent = ""; return; }
    const d = p.seriesData.get(window.__candleSeries);
    if (!d || d.close == null) { el.textContent = ""; return; }
    el.innerHTML = `O ${N(d.open)} H ${N(d.high)} L ${N(d.low)} C ${N(d.close)}`;
  });
})();

function enhanceInsight() {
  const box = $("insight");
  if (!box || !curCandles.length) return;
  if (box.querySelector(".pcx")) return;
  const c = curCandles, last = c[c.length - 1];
  if (!last) return;
  const closes = c.map(k => k.c);
  const r = rsi(closes, 14);
  const atr = c.slice(-14).reduce((a, k) => a + (k.h - k.l) / k.c * 100, 0) / Math.min(14, c.length);
  const yr = c.slice(-365);
  const hi = Math.max(...yr.map(k => k.h)), lo = Math.min(...yr.map(k => k.l));
  const pos = hi > lo ? ((last.c - lo) / (hi - lo)) * 100 : 50;
  const e200 = emaAt(closes, Math.min(200, Math.max(2, closes.length - 1)));
  const above = last.c >= e200;
  const vAvg = c.slice(-21, -1).reduce((a, k) => a + k.v, 0) / Math.max(1, c.slice(-21, -1).length);
  const vr = vAvg ? last.v / vAvg : null;
  const sig = ST.signals.find(x => x.symbol === curSymbol);
  let q = null;
  if (sig) {
    const dSup = sig.support ? ((sig.entry - sig.support) / sig.entry) * 100 : 0;
    q = Math.max(5, Math.min(99, Math.round(45 + Math.min(25, dSup * 6) + Math.min(20, tpPct(sig) / 2) - Math.abs(r - 55) / 6)));
  }
  const qc = q == null ? "" : q >= 70 ? "good" : q >= 45 ? "warn" : "bad";
  const wrap = document.createElement("span");
  wrap.className = "pcx";
  wrap.style.display = "contents";
  wrap.innerHTML = `
    <span class="bx ${r > 70 ? "bad" : r < 30 ? "good" : ""}" title="RSI over 14 daily candles">RSI <b>${r.toFixed(0)}</b></span>
    <span class="bx" title="Average daily range, last 14 candles">ATR <b>${atr.toFixed(1)}%</b></span>
    <span class="bx ${above ? "good" : "bad"}" title="Last close versus the 200-day EMA">${above ? "Above" : "Below"} EMA200</span>
    <span class="bx" title="Volume today versus its 20-day average">VOL <b>${vr == null ? "—" : vr.toFixed(1) + "×"}</b></span>
    ${q == null ? "" : `<span class="bx ${qc}" title="Entry quality: room above support and room to TP">Quality <b>${q}</b></span>`}
    <span class="bx" title="Position inside the 52-week range" style="gap:6px">52w
      <span class="meter"><i style="width:${Math.max(2, Math.min(100, pos)).toFixed(0)}%"></i></span><b>${pos.toFixed(0)}%</b></span>`;
  box.appendChild(wrap);
}

/* watch the page for new chart draws and list renders */
let chartTimer = null;
function onChartMaybeChanged() {
  clearTimeout(chartTimer);
  chartTimer = setTimeout(() => {
    const sym = ($("chartSym") || {}).textContent;
    if (!sym || sym === "—") return;
    const arr = ST.charts && ST.charts.get(sym);
    if (!arr || !arr.length) return;
    if (sym === curSymbol && arr === curCandles) return;
    curSymbol = sym; curCandles = arr;
    const res = R.analyze(arr);
    markersCache = res.signals.map(s => {
      const t = Math.floor(s.t / 1000);
      return { time: t, position: s.outcome === "TP" ? "aboveBar" : "belowBar", shape: s.outcome === "TP" ? "arrowDown" : "arrowUp", color: s.outcome === "TP" ? "#60a5fa" : "#eab308", size: 1 };
    });
    setTimeout(() => {
      applyMarkers();
      bandSeries().forEach(s => { try { s.applyOptions({ visible: bandsOn }); } catch (e) {} });
      enhanceInsight();
      if (cmpSeries && cmpSym) compareWith(cmpSym);
    }, 260);
  }, 420);
}
new MutationObserver(onChartMaybeChanged).observe($("chartSym") || document.body, { childList: true, characterData: true, subtree: true });

/* ---------------- signal cards ---------------- */
const pick = new Set();
function decorate() {
  const box = $("signals");
  if (!box) return;
  const cards = [...box.querySelectorAll(".sig")];
  for (const el of cards) {
    const symEl = el.querySelector(".sym");
    if (!symEl) continue;
    const sym = symEl.textContent.trim();
    const s = ST.signals.find(x => x.symbol === sym);
    if (!s) continue;
    if (cfg.top100 && (s.rank || 1e9) > 100) { el.remove(); continue; }
    if (cfg.hideTp && s.outcome === "TP") { el.remove(); continue; }
    const m = mkt(sym);
    const px = m && Number.isFinite(m.price) ? m.price : null;
    el.dataset.gain = px == null ? "" : String(((px / s.entry - 1) * 100).toFixed(2));
    if (!el.querySelector(".rem") && px != null && s.outcome !== "TP" && s.tp > px) {
      const rows = el.querySelector(".sig-rows");
      if (rows) {
        const sp = document.createElement("span");
        sp.className = "rem num";
        sp.innerHTML = `<em style="color:#c8f751">REM</em> <b>${P((s.tp / px - 1) * 100)}</b>`;
        sp.title = "Still needed to reach the TP midline";
        rows.appendChild(sp);
      }
    }
    const foot = el.querySelector(".sig-foot");
    if (foot && !foot.querySelector(".pfbtn")) {
      const b = document.createElement("button");
      b.className = "pfbtn"; b.textContent = "＋"; b.title = "Add a $100 paper trade";
      b.onclick = e => { e.stopPropagation(); pfAdd(sym); };
      foot.appendChild(b);
    }
    if (cfg.select && !el.querySelector(".pick")) {
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "pick"; cb.checked = pick.has(sym);
      cb.onclick = e => { e.stopPropagation(); cb.checked ? pick.add(sym) : pick.delete(sym); };
      el.appendChild(cb);
    }
  }
  if (ST.sort === "gain") {
    const arr = [...box.querySelectorAll(".sig")];
    arr.sort((a, b) => Number(b.dataset.gain || -1e9) - Number(a.dataset.gain || -1e9));
    arr.forEach(x => box.appendChild(x));
  }
  if (ST.filter === "top100") {
    const cnt = $("sigCount");
    if (cnt) cnt.textContent = `${box.querySelectorAll(".sig").length} top-100 signals`;
  }
  renderPulse();
  chromeSync();
}
let deco = null;
new MutationObserver(() => {
  clearTimeout(deco);
  deco = setTimeout(decorate, 70);
}).observe($("signals") || document.body, { childList: true });

/* extra filter + sort option */
(function filters() {
  const seg = $("sigFilter");
  if (seg) {
    const b = document.createElement("button");
    b.dataset.f = "top100"; b.textContent = "Top 100";
    b.onclick = () => {
      ST.filter = "top100";
      document.querySelectorAll("#sigFilter button").forEach(x => x.classList.toggle("on", x === b));
      R.renderSignals();
    };
    seg.appendChild(b);
  }
  const sort = $("sigSort");
  if (sort) {
    const o = document.createElement("option");
    o.value = "gain"; o.textContent = "Gain since signal";
    sort.appendChild(o);
  }
})();

/* ---------------- header / chrome ---------------- */
const actions = document.querySelector(".top .actions");
if (actions) {
  const b = document.createElement("button");
  b.className = "btn"; b.id = "packBtn"; b.textContent = "✦ Tools"; b.title = "All the extras (T)";
  b.onclick = () => openTools();
  actions.insertBefore(b, actions.firstChild);
}

const mini = document.createElement("div");
mini.className = "mini-bar"; mini.id = "miniBar";
mini.innerHTML = `<b id="miniStatus">Live</b><span class="grow" id="miniScan">Scanning…</span>
  <span class="track"><i id="miniFill"></i></span><span id="miniNext">—</span>`;
document.body.appendChild(mini);

const topBtn = document.createElement("button");
topBtn.className = "top-btn"; topBtn.id = "topBtn"; topBtn.textContent = "↑"; topBtn.title = "Back to top";
topBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
document.body.appendChild(topBtn);

const offBar = document.createElement("div");
offBar.className = "offline"; offBar.id = "offlineBar";
offBar.textContent = "You are offline — showing the last saved scan";
document.body.appendChild(offBar);

(function observers() {
  const header = document.querySelector("header.top");
  if (header && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => {
      const away = !es[0].isIntersecting;
      mini.classList.toggle("on", away);
      topBtn.classList.toggle("on", away);
    }, { threshold: 0 });
    io.observe(header);
  }
  const sync = () => offBar.classList.toggle("on", !navigator.onLine);
  window.addEventListener("online", () => { sync(); ping("Back online"); });
  window.addEventListener("offline", sync);
  sync();
  if (cfg.tips && header) {
    const tips = document.createElement("div");
    tips.className = "tip-bar";
    tips.innerHTML = `<span>Tip: <b>/</b> search · <b>Ctrl K</b> jump to a coin · <b>F</b> fullscreen · <b>?</b> shortcuts · <b>T</b> extras</span>
      <button title="Dismiss">✕</button>`;
    tips.querySelector("button").onclick = () => { tips.remove(); cfg.tips = false; saveCfg(); };
    header.appendChild(tips);
  }
})();

let flash = null;
function chromeSync() {
  const st = $("miniStatus"), sc = $("miniScan"), fl = $("miniFill"), nx = $("miniNext");
  if (st && $("statusText")) st.textContent = $("statusText").textContent;
  if (sc && $("scanText")) sc.textContent = $("scanText").textContent;
  if (fl && $("scanBar")) fl.style.width = $("scanBar").style.width || "0%";
  if (nx && $("countdown")) nx.textContent = $("countdown").textContent.replace("Next daily candle in ", "");
  if (cfg.title && !flash) {
    const n = ST.signals.length;
    document.title = n ? `Shahab Radar · ${n} signal${n === 1 ? "" : "s"}` : "Shahab Radar";
  }
  if (cfg.favicon) favicon();
}
let favAt = 0;
function favicon() {
  const now = Date.now();
  if (now - favAt < 5000) return;
  favAt = now;
  const fresh = ST.signals.filter(s => now - s.candleTime < 7 * 864e5).length;
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d");
    g.fillStyle = "#0b0b0c"; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = "#a3e635"; g.lineWidth = 3;
    g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(32, 32); g.lineTo(48, 16); g.stroke();
    if (fresh) {
      g.fillStyle = "#c8f751"; g.beginPath(); g.arc(50, 50, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0a0f02"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(Math.min(99, fresh)), 50, 51);
    }
    let link = document.querySelector("link[rel='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = cv.toDataURL("image/png");
  } catch (e) {}
}
setInterval(chromeSync, 1000);

/* new signal detection (polls the saved list) */
let seen = new Set();
setInterval(() => {
  const ids = new Set(ST.signals.map(s => s.id));
  if (seen.size) {
    const added = ST.signals.filter(s => !seen.has(s.id));
    if (added.length) {
      tone(true);
      sysNotify(`${added.length} new daily signal${added.length > 1 ? "s" : ""}`, added.slice(0, 6).map(s => s.symbol).join(", "));
      clearInterval(flash);
      let on = false, k = 0;
      flash = setInterval(() => {
        on = !on;
        document.title = on ? `✦ ${added.length} new signal${added.length > 1 ? "s" : ""}` : "Shahab Radar";
        if (++k > 14) { clearInterval(flash); flash = null; chromeSync(); }
      }, 900);
    }
  }
  seen = ids;
}, 4000);

/* TP-progress alerts + live portfolio refresh */
const alerted = new Set();
setInterval(() => {
  const hits = [];
  for (const s of ST.signals) {
    if (s.outcome === "TP") continue;
    const p = prog(s);
    if (p != null && p >= cfg.tpAlert && !alerted.has(s.id)) { alerted.add(s.id); hits.push(`${s.symbol} ${p.toFixed(0)}% to TP`); }
  }
  if (hits.length) {
    tone(false);
    sysNotify("Getting close to TP", hits.join(" · "));
    ping(`Near TP: ${hits.join(" · ")}`);
  }
  renderPulse();
}, 15000);

/* ---------------- tools modal ---------------- */
const tools = document.createElement("div");
tools.className = "modal"; tools.id = "toolsModal"; tools.hidden = true;
tools.innerHTML = `<div class="modal-box" style="max-width:620px">
  <div class="modal-head"><h3>✦ Extras &amp; settings</h3><button class="btn small" id="toolsClose">Close</button></div>
  <div class="tabs" id="toolsTabs">
    <button class="on" data-t="look">Look</button><button data-t="list">List</button>
    <button data-t="chart">Chart</button><button data-t="alerts">Alerts</button><button data-t="data">Data</button>
  </div><div id="toolsBody"></div></div>`;
document.body.appendChild(tools);
tools.querySelector("#toolsClose").onclick = () => { tools.hidden = true; };
tools.addEventListener("click", e => { if (e.target === tools) tools.hidden = true; });

function row(label, desc, ctl) {
  const r = document.createElement("div");
  r.className = "dr";
  r.innerHTML = `<div><div class="lb">${label}</div><div class="ds">${desc}</div></div><div class="ctl"></div>`;
  const c = r.querySelector(".ctl");
  (Array.isArray(ctl) ? ctl : [ctl]).forEach(x => c.appendChild(x));
  return r;
}
function sw(get, set) {
  const b = document.createElement("button");
  b.className = `sw${get() ? " on" : ""}`;
  b.onclick = () => { set(!get()); b.classList.toggle("on", get()); };
  return b;
}
function bt(text, fn, primary) {
  const b = document.createElement("button");
  b.className = `btn small${primary ? " primary" : ""}`; b.textContent = text; b.onclick = fn;
  return b;
}
const copy = txt => navigator.clipboard.writeText(txt).then(() => ping("Copied")).catch(() => window.prompt("Copy:", txt));

function renderTools(tab) {
  const body = tools.querySelector("#toolsBody");
  body.innerHTML = "";
  if (tab === "look") {
    const seg = document.createElement("div"); seg.className = "seg";
    [["lime", "Lime"], ["blue", "Blue"], ["violet", "Violet"], ["amber", "Amber"]].forEach(([k, l]) => {
      const b = document.createElement("button");
      b.textContent = l; b.className = cfg.theme === k ? "on" : "";
      b.onclick = () => {
        cfg.theme = k; saveCfg();
        document.body.dataset.theme = k === "lime" ? "" : k;
        seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      };
      seg.appendChild(b);
    });
    body.appendChild(row("Accent theme", "Four colour moods, saved on this device.", seg));
    body.appendChild(row("Compact cards", "Tighter grid with smaller rows.", sw(() => cfg.dense, v => { cfg.dense = v; document.body.classList.toggle("dense", v); saveCfg(); })));
    body.appendChild(row("Show statistics", "The five numbers above the signals.", sw(() => cfg.stats, v => { cfg.stats = v; saveCfg(); if (statsEl) statsEl.style.display = v ? "" : "none"; })));
    body.appendChild(row("Focus mode", "Chart only — hides stats, list and pulse.", sw(() => cfg.focus, v => { cfg.focus = v; document.body.classList.toggle("focus", v); saveCfg(); })));
    body.appendChild(row("Quiet mode", "Mute the little pop-up messages.", sw(() => cfg.quiet, v => { cfg.quiet = v; saveCfg(); })));
    body.appendChild(row("Count in the tab title", "Always show how many signals are saved.", sw(() => cfg.title, v => { cfg.title = v; saveCfg(); chromeSync(); })));
    body.appendChild(row("Favicon badge", "A lime counter on the tab icon for fresh signals.", sw(() => cfg.favicon, v => { cfg.favicon = v; saveCfg(); favicon(); })));
  }
  if (tab === "list") {
    body.appendChild(row("Top 100 only", "Only signals from the 100 biggest markets.", sw(() => cfg.top100, v => { cfg.top100 = v; saveCfg(); R.renderSignals(); })));
    body.appendChild(row("Hide TP'd signals", "Keep only the signals that are still open.", sw(() => cfg.hideTp, v => { cfg.hideTp = v; saveCfg(); R.renderSignals(); })));
    body.appendChild(row("Select mode", "Adds a checkbox to every card for bulk copying.", sw(() => cfg.select, v => { cfg.select = v; saveCfg(); R.renderSignals(); })));
    body.appendChild(row("Bulk copy", "Tickers or a ready Markdown table.", [
      bt("Tickers", () => { const l = [...pick]; if (!l.length) return ping("Tick some cards first"); copy(l.join(", ")); }),
      bt("Markdown", () => {
        const rows = ST.signals.slice().sort((a, b) => b.candleTime - a.candleTime).slice(0, 40);
        copy(["| Coin | Entry | TP | TP % | Status |", "| --- | --- | --- | --- | --- |"].concat(rows.map(s => `| ${s.symbol} | ${N(s.entry)} | ${N(s.tp)} | ${tpPct(s).toFixed(2)}% | ${s.outcome} |`)).join("\n"));
      }),
    ]));
    body.appendChild(row("Download", "Signals as JSON, or the visible list as CSV.", [
      bt("JSON", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(ST.signals, null, 1)], { type: "application/json" }));
        a.download = "shahab-radar-signals.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000); ping("Signals exported");
      }),
      bt("CSV", () => ($("exportCsv") || { click() {} }).click()),
    ]));
  }
  if (tab === "chart") {
    body.appendChild(row("Support / TP / resistance lines", "The three bands drawn over the candles.", sw(() => bandsOn, v => {
      bandsOn = v; saveCfg(); bandSeries().forEach(s => { try { s.applyOptions({ visible: v }); } catch (e) {} });
    })));
    body.appendChild(row("Signal arrows", "Arrows where each signal printed.", sw(() => markersOn, v => { markersOn = v; saveCfg(); applyMarkers(); })));
    body.appendChild(row("Compare a coin", `Normalised % line on the left scale${cmpSym ? ` · now ${cmpSym}` : ""}.`, [
      bt("Pick", () => { const r = window.prompt("Compare with coin:", cmpSym || "ETH"); if (r !== null) compareWith(r.trim().toUpperCase() || null); }),
      bt("Clear", () => compareWith(null)),
    ]));
    body.appendChild(row("Chart image", "Save the current chart as a PNG.", bt("Save PNG", () => chartShot())));
    body.appendChild(row("Drawing backup", "Move your charts' drawings between browsers.", [
      bt("Export", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(R.drawings, null, 1)], { type: "application/json" }));
        a.download = "shahab-radar-drawings.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000); ping("Drawings exported");
      }),
      bt("Import", () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "application/json";
        inp.onchange = async () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          try {
            const d = JSON.parse(await f.text());
            Object.assign(R.drawings, d);
            localStorage.setItem("shahab-radar-drawings-v1", JSON.stringify(R.drawings));
            ping("Drawings imported — reopen the coin");
          } catch (e) { ping("That file is not a drawing backup"); }
        };
        inp.click();
      }),
    ]));
    body.appendChild(row("Quick ranges", "Around the latest candle.", [bt("1M", () => chartRange(30)), bt("3M", () => chartRange(92)), bt("6M", () => chartRange(183)), bt("1Y", () => chartRange(365)), bt("All", () => chartRange(curCandles.length + 6))]));
  }
  if (tab === "alerts") {
    const wrap = document.createElement("div");
    wrap.style.display = "flex"; wrap.style.gap = "6px"; wrap.style.alignItems = "center";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "20"; inp.max = "99"; inp.value = String(cfg.tpAlert);
    inp.className = "input"; inp.style.width = "74px"; inp.style.height = "30px";
    inp.onchange = () => {
      const v = Math.max(20, Math.min(99, Number(inp.value) || 80));
      cfg.tpAlert = v; inp.value = v; saveCfg(); ping(`Alert at ${v}% of the way to TP`);
    };
    wrap.appendChild(inp); wrap.appendChild(document.createTextNode("%"));
    body.appendChild(row("Alert threshold", "Warn when an open trade is this close to its TP.", wrap));
    body.appendChild(row("Alert tone", "Sound used by the new alerts.", bt(["Chime", "Soft", "Triple"][cfg.tone % 3], () => {
      cfg.tone = (cfg.tone + 1) % 3; saveCfg(); tone(true); renderTools("alerts");
    })));
    body.appendChild(row("Browser notifications", "Ask for permission once, then alerts pop up even in a background tab.", bt("Enable", async () => {
      try {
        const p = await Notification.requestPermission();
        ping(p === "granted" ? "Notifications enabled" : "Notifications blocked in the browser");
      } catch (e) { ping("Notifications unavailable"); }
    })));
    body.appendChild(row("Saved price alerts", `${Object.keys(alerts).length} from the ◎ buttons.`, bt("Manage", () => openAlerts())));
    body.appendChild(row("Test", "Hear the tone that will play.", bt("Play", () => tone(true))));
  }
  if (tab === "data") {
    let bytes = 0;
    try { bytes = (localStorage.getItem("shahab-radar-d1-v8") || "").length; } catch (e) {}
    body.appendChild(row("Saved scan", `${(bytes / 1024).toFixed(0)} KB · ${ST.markets.length} markets · saved ${ST.at ? new Date(ST.at).toLocaleTimeString("en-GB") : "—"}`, bt("Rescan", () => {
      tools.hidden = true;
      const b = $("refresh"); if (b) b.click();
    }, true)));
    body.appendChild(row("Connection", "Check Gate.io latency right now.", bt("Measure", async () => {
      const t = performance.now();
      try { await fetch("https://api.gateio.ws/api/v4/spot/currencies/BTC"); ping(`Gate.io answered in ${Math.round(performance.now() - t)} ms`); }
      catch (e) { ping("Could not reach Gate.io"); }
    })));
    body.appendChild(row("Reset local data", "Clears the saved scan, watchlist, alerts, drawings and portfolio.", bt("Reset", () => {
      if (!window.confirm("Reset everything this site saved in your browser?")) return;
      ["shahab-radar-d1-v8", "shahab-radar-drawings-v1", "shahab-radar-watch-v1", "shahab-radar-alerts-v1", "shahab-radar-notify-v1", "shahab-radar-view-v1", KEY, PFK]
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      location.reload();
    })));
  }
}
function openTools(tab) {
  tools.hidden = false;
  tools.querySelectorAll("#toolsTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === (tab || "look")));
  renderTools(tab || "look");
}
tools.querySelector("#toolsTabs").onclick = e => {
  const b = e.target.closest("button[data-t]");
  if (!b) return;
  tools.querySelectorAll("#toolsTabs button").forEach(x => x.classList.toggle("on", x === b));
  renderTools(b.dataset.t);
};

/* ---------------- alerts list ---------------- */
let alerts = {};
try { alerts = JSON.parse(localStorage.getItem("shahab-radar-alerts-v1") || "{}") || {}; } catch { alerts = {}; }
const saveAlerts = () => { try { localStorage.setItem("shahab-radar-alerts-v1", JSON.stringify(alerts)); } catch {} };
const am = document.createElement("div");
am.className = "modal"; am.id = "alertsModal"; am.hidden = true;
am.innerHTML = `<div class="modal-box" style="max-width:460px"><div class="modal-head"><h3>Price alerts</h3>
  <button class="btn small" id="alertsClose">Close</button></div><div id="alertsBody"></div></div>`;
document.body.appendChild(am);
am.querySelector("#alertsClose").onclick = () => { am.hidden = true; };
function openAlerts() {
  const keys = Object.keys(alerts);
  const body = am.querySelector("#alertsBody");
  body.innerHTML = keys.length
    ? keys.map(k => `<div class="dr"><div><div class="lb">${k}</div><div class="ds">Notify above ${N(alerts[k])}</div></div>
        <div class="ctl"><button class="btn small" data-del="${k}">Remove</button></div></div>`).join("")
    : `<p class="muted" style="font-size:11.5px;margin:8px 0">No alerts yet. Tap the ◎ button on a signal card to add one.</p>`;
  body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    delete alerts[b.dataset.del]; saveAlerts(); openAlerts(); ping("Alert removed");
  });
  am.hidden = false;
}

/* ---------------- command palette ---------------- */
const cm = document.createElement("div");
cm.className = "modal"; cm.id = "cmdModal"; cm.hidden = true;
cm.innerHTML = `<div class="modal-box" style="max-width:460px"><div class="modal-head"><h3>Jump to a coin</h3>
  <button class="btn small" id="cmdClose">Esc</button></div>
  <input id="cmdInput" class="input" placeholder="Type a ticker… e.g. ETH" autocomplete="off" spellcheck="false">
  <div class="cmd-list" id="cmdList"></div></div>`;
document.body.appendChild(cm);
cm.querySelector("#cmdClose").onclick = () => { cm.hidden = true; };
let cmdHits = [], cmdIdx = 0;
function cmdRender(q) {
  const list = $("cmdList");
  const query = q.trim().toUpperCase();
  cmdHits = ST.markets.filter(m => m.symbol.includes(query) || m.pair.includes(query)).slice(0, 40);
  if (!cmdHits.length) { list.innerHTML = `<div class="muted" style="font-size:11.5px;padding:6px">No market matches.</div>`; return; }
  cmdIdx = Math.min(cmdIdx, cmdHits.length - 1);
  list.innerHTML = cmdHits.map((m, i) => `<button data-i="${i}" class="${i === cmdIdx ? "sel" : ""}">
    <span>${m.symbol}</span><b>#${m.rank} · ${P(m.change)}</b></button>`).join("");
  list.querySelectorAll("button").forEach(b => b.onclick = () => cmdGo(Number(b.dataset.i)));
}
function cmdGo(i) {
  const m = cmdHits[i];
  if (!m) return;
  cm.hidden = true;
  const card = [...document.querySelectorAll("#signals .sig")].find(c => c.querySelector(".sym") && c.querySelector(".sym").textContent.trim() === m.symbol);
  if (card) { card.click(); return; }
  location.href = `${location.pathname}?coin=${encodeURIComponent(m.symbol)}`;
}
function openCmd() {
  cm.hidden = false;
  const inp = $("cmdInput");
  inp.value = ""; cmdIdx = 0; cmdRender("");
  setTimeout(() => inp.focus(), 40);
}
$("cmdInput").oninput = e => { cmdIdx = 0; cmdRender(e.target.value); };
$("cmdInput").onkeydown = e => {
  if (e.key === "Enter") cmdGo(cmdIdx);
  else if (e.key === "ArrowDown") { e.preventDefault(); cmdIdx = Math.min(cmdHits.length - 1, cmdIdx + 1); cmdRender(e.target.value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmdIdx = Math.max(0, cmdIdx - 1); cmdRender(e.target.value); }
  else if (e.key === "Escape") cm.hidden = true;
};

/* ---------------- shortcuts help ---------------- */
const hm = document.createElement("div");
hm.className = "modal"; hm.id = "helpModal"; hm.hidden = true;
hm.innerHTML = `<div class="modal-box" style="max-width:440px"><div class="modal-head"><h3>Keyboard shortcuts</h3>
  <button class="btn small" id="helpClose">Close</button></div>
  <div class="help-row"><span class="kbd">/</span><span>Search the signal list</span></div>
  <div class="help-row"><span class="kbd">Ctrl</span><span class="kbd">K</span><span>Jump to a coin</span></div>
  <div class="help-row"><span class="kbd">F</span><span>Fullscreen chart</span></div>
  <div class="help-row"><span class="kbd">J</span><span class="kbd">K</span><span>Next / previous signal</span></div>
  <div class="help-row"><span class="kbd">T</span><span>Extras panel</span></div>
  <div class="help-row"><span class="kbd">?</span><span>This list</span></div>
  <div class="help-row"><span class="kbd">Esc</span><span>Close overlays</span></div></div>`;
document.body.appendChild(hm);
hm.querySelector("#helpClose").onclick = () => { hm.hidden = true; };
hm.addEventListener("click", e => { if (e.target === hm) hm.hidden = true; });

document.addEventListener("keydown", e => {
  if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") { e.preventDefault(); openCmd(); return; }
  if (e.key === "?") { e.preventDefault(); hm.hidden = false; return; }
  if (String(e.key).toLowerCase() === "t") { openTools(); return; }
  if (e.key === "j" || e.key === "k") {
    const cards = [...document.querySelectorAll("#signals .sig")];
    if (!cards.length) return;
    const at = cards.findIndex(c => c.dataset.active === "1");
    let n = e.key === "j" ? at + 1 : at - 1;
    if (n < 0) n = cards.length - 1;
    if (n >= cards.length) n = 0;
    cards.forEach(c => { c.dataset.active = ""; c.style.outline = ""; });
    cards[n].dataset.active = "1";
    cards[n].style.outline = "2px solid rgba(200,247,81,.55)";
    cards[n].scrollIntoView({ behavior: "smooth", block: "center" });
    cards[n].click();
    setTimeout(() => { cards[n].style.outline = ""; }, 2000);
    return;
  }
  if (e.key === "Escape") { [cm, hm, am, tools].forEach(x => { x.hidden = true; }); }
});

/* ---------------- boot ---------------- */
try {
  document.body.dataset.theme = cfg.theme === "lime" ? "" : cfg.theme;
  document.body.classList.toggle("dense", !!cfg.dense);
  document.body.classList.toggle("focus", !!cfg.focus);
  if (!cfg.stats && statsEl) statsEl.style.display = "none";
} catch (e) {}

setInterval(() => { decorate(); }, 20000);
setTimeout(() => { decorate(); renderPulse(true); chromeSync(); }, 1500);
