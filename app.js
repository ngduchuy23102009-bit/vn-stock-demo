/* ============================================================
   VN Stock Demo — app.js
   Dữ liệu: API công khai VNDirect (api-finfo.vndirect.com.vn)
   Lưu ý: API chỉ nhận truy vấn theo NGÀY CHÍNH XÁC (không theo
   khoảng). Lịch sử = gom nhiều request theo ngày + cache local.
   ============================================================ */
"use strict";

const API_BASE = "https://api-finfo.vndirect.com.vn/v4/stock_prices";
const REFRESH_MS = 30000;
const START_CASH = 500_000_000;
const HISTORY_BATCH = 12;

const fmt = (n, d = 2) =>
  n == null || isNaN(n) ? "--" :
  n.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtVol = (n) => {
  if (n == null) return "--";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " tỷ";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + " tr";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};
const fmtVnd = (n) => Math.round(n).toLocaleString("vi-VN") + " ₫";
// giá API tính theo nghìn đồng -> quy đổi ra VND
const toVnd = (price, qty) => price * qty * 1000;
const dateStr = (d) => d.toISOString().slice(0, 10);
const todayStr = () => dateStr(new Date());
const daysAgoStr = (d) => dateStr(new Date(Date.now() - d * 86400000));
const isWeekend = (d) => { const g = d.getUTCDay(); return g === 0 || g === 6; };
// danh sách ngày giao dịch (bỏ T7/CN), gần nhất trước
function tradingDates(n) {
  const out = [];
  let d = new Date();
  while (out.length < n) {
    if (!isWeekend(d)) out.push(dateStr(d));
    d = new Date(d.getTime() - 86400000);
  }
  return out;
}

/* ---------------- API (theo ngày chính xác) ---------------- */
async function fetchDay(q, date) {
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&size=5000&sort=date`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("API lỗi: " + res.status);
  const json = await res.json();
  return json.data || [];
}

// trả về Map code -> record của phiên mới nhất có dữ liệu (lùi tối đa 6 ngày)
async function loadLatestFloorData(floor) {
  for (let back = 0; back < 8; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    if (isWeekend(d)) continue;
    const rows = await fetchDay(`floor:${floor}~date:${dateStr(d)}`);
    if (rows.length) {
      const map = new Map();
      for (const r of rows) map.set(r.code, r);
      return { date: dateStr(d), rows: map };
    }
  }
  return { date: null, rows: new Map() };
}

// Lịch sử n ngày giao dịch, cache localStorage theo mã
async function fetchHistory(code, nDays) {
  const key = `vd_hist:${code}`;
  const cache = JSON.parse(localStorage.getItem(key) || "{}");
  const dates = tradingDates(nDays);
  const missing = dates.filter((d) => !(d in cache));
  for (let i = 0; i < missing.length; i += HISTORY_BATCH) {
    const batch = missing.slice(i, i + HISTORY_BATCH);
    const results = await Promise.all(
      batch.map((d) =>
        fetchDay(`code:${code}~date:${d}`)
          .then((rows) => [d, rows[0] || null])
          .catch(() => [d, null])
      )
    );
    for (const [d, rec] of results) cache[d] = rec;
    localStorage.setItem(key, JSON.stringify(cache));
  }
  return dates.map((d) => cache[d]).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/* ---------------- State ---------------- */
const State = {
  quotes: new Map(),
  prevQuotes: new Map(),
  sessionDate: null,
  floor: "HOSE",
  view: "dashboard",
  watchlist: JSON.parse(localStorage.getItem("vd_watchlist") || "[]"),
  portfolio: JSON.parse(localStorage.getItem("vd_portfolio") || '{"cash":' + START_CASH + ',"holdings":{},"trades":[]}'),
  allCodes: new Set(),
};

function savePortfolio() { localStorage.setItem("vd_portfolio", JSON.stringify(State.portfolio)); }
function saveWatchlist() { localStorage.setItem("vd_watchlist", JSON.stringify(State.watchlist)); }

/* ---------------- Trạng thái thị trường ---------------- */
function vnNow() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}
// trong phiên liên tục + ATC: T2-T6, 9:00-15:00 giờ VN
function isMarketOpenNow() {
  const vn = vnNow();
  const day = vn.getDay();
  const mins = vn.getHours() * 60 + vn.getMinutes();
  return day >= 1 && day <= 5 && mins >= 540 && mins <= 900;
}
function marketStatus() {
  const el = document.getElementById("market-status");
  if (isMarketOpenNow()) {
    el.textContent = "🟢 Thị trường đang mở cửa";
    el.className = "market-status open";
    return true;
  }
  el.textContent = "🔴 Thị trường đóng cửa (hiển thị phiên gần nhất)";
  el.className = "market-status closed";
  return false;
}

/* ---------------- Render ---------------- */
function classify(rec) {
  if (!rec || rec.close == null || rec.basicPrice == null) return "ref";
  if (rec.close > rec.basicPrice) return "up";
  if (rec.close < rec.basicPrice) return "down";
  return "ref";
}

function renderSummary() {
  const box = document.getElementById("indices");
  let adv = 0, dec = 0, unch = 0, vol = 0, val = 0;
  for (const r of State.quotes.values()) {
    const c = classify(r);
    if (c === "up") adv++; else if (c === "down") dec++; else unch++;
    vol += (r.nmVolume || 0) + (r.ptVolume || 0);
    val += (r.nmValue || 0) + (r.ptValue || 0);
  }
  const cards = [
    ["Số mã tăng / giảm", `<span class="up">${adv} ▲</span> / <span class="down">${dec} ▼</span> <span class="ref">(${unch} đứng)</span>`],
    ["Tổng khối lượng khớp lệnh", fmtVol(vol)],
    ["Tổng giá trị khớp lệnh", fmtVnd(val)],
  ];
  box.innerHTML = cards.map(([k, v]) =>
    `<div class="index-card"><div class="name">${k}</div><div class="value" style="font-size:20px">${v}</div>
     <div class="chg ref">Phiên ${State.sessionDate || "--"}</div></div>`).join("");
}

function rowsForCurrentView() {
  let codes = [...State.quotes.keys()];
  if (State.view === "watchlist") {
    codes = State.watchlist.filter((c) => State.quotes.has(c));
  } else {
    const floor = State.floor;
    codes = codes.filter((c) => (State.quotes.get(c).floor || "").toUpperCase() === floor);
  }
  const q = document.getElementById("search-box").value.trim().toUpperCase();
  if (q) codes = codes.filter((c) => c.includes(q));
  codes.sort((a, b) => (State.quotes.get(b).nmVolume || 0) - (State.quotes.get(a).nmVolume || 0));
  return codes.map((c) => State.quotes.get(c));
}

function rowHTML(r, view) {
  const cls = classify(r);
  const starred = State.watchlist.includes(r.code);
  let cells = `
    <td><span class="sym">${r.code}</span><span class="floor-tag">${r.floor || ""}</span></td>
    <td class="num ${cls}"><b>${fmt(r.close)}</b></td>
    <td class="num ${cls}">${r.change > 0 ? "+" : ""}${fmt(r.change)}</td>
    <td class="num ${cls}">${r.pctChange > 0 ? "+" : ""}${fmt(r.pctChange)}%</td>`;
  if (view !== "watchlist") {
    cells += `
      <td class="num down">${fmt(r.ceilingPrice)}</td>
      <td class="num up">${fmt(r.floorPrice)}</td>`;
  }
  cells += `
      <td class="num">${fmt(r.open)}</td>
      <td class="num up">${fmt(r.high)}</td>
      <td class="num down">${fmt(r.low)}</td>
      <td class="num">${fmtVol((r.nmVolume || 0) + (r.ptVolume || 0))}</td>
      <td><span class="star ${starred ? "on" : ""}" data-star="${r.code}" title="Thêm/bỏ watchlist">${starred ? "★" : "☆"}</span></td>`;
  return `<tr data-code="${r.code}" data-view="${view}">${cells}</tr>`;
}

function renderTable() {
  const rows = rowsForCurrentView();
  const dashBody = document.querySelector("#price-table tbody");
  const wlBody = document.getElementById("watchlist-body");
  const view = State.view === "watchlist" ? "watchlist" : "dashboard";
  const target = view === "watchlist" ? wlBody : dashBody;
  (view === "watchlist" ? dashBody : wlBody).innerHTML = "";
  target.innerHTML = rows.map((r) => rowHTML(r, view)).join("") ||
    `<tr><td colspan="11" style="text-align:center;color:var(--muted)">Không có dữ liệu</td></tr>`;
  document.getElementById("watchlist-empty").classList.toggle("hidden", view !== "watchlist" || rows.length > 0);
  document.getElementById("updated-at").textContent =
    "Cập nhật: " + new Date().toLocaleTimeString("vi-VN");
}

function applyFlash() {
  for (const [code, prev] of State.prevQuotes) {
    const cur = State.quotes.get(code);
    if (!cur || prev.close === cur.close) continue;
    const tr = document.querySelector(`tr[data-code="${code}"]`);
    if (!tr) continue;
    const cls = cur.close > prev.close ? "flash-up" : "flash-down";
    tr.classList.remove("flash-up", "flash-down");
    void tr.offsetWidth;
    tr.classList.add(cls);
  }
}

function renderPortfolio() {
  const p = State.portfolio;
  let stockValue = 0;
  const body = document.getElementById("portfolio-body");
  const entries = Object.entries(p.holdings).filter(([, h]) => h.qty > 0);
  body.innerHTML = entries.map(([code, h]) => {
    const r = State.quotes.get(code);
    const price = r ? r.close : h.avgCost;
    const val = toVnd(price, h.qty), cost = toVnd(h.avgCost, h.qty);
    stockValue += val;
    const pnl = val - cost, pct = cost ? (pnl / cost) * 100 : 0;
    const cls = pnl > 0 ? "up" : pnl < 0 ? "down" : "ref";
    return `<tr data-code="${code}" data-view="portfolio">
      <td><span class="sym">${code}</span></td>
      <td class="num">${fmt(h.qty - (h.frozen || 0), 0)}${h.frozen ? ` <span class="ref">(+${fmt(h.frozen, 0)} giữ)</span>` : ""}</td>
      <td class="num">${fmt(h.avgCost)}</td>
      <td class="num ${classify(r)}">${fmt(price)}</td>
      <td class="num">${fmtVnd(val)}</td>
      <td class="num ${cls}">${pnl > 0 ? "+" : ""}${fmtVnd(pnl)}</td>
      <td class="num ${cls}">${pct > 0 ? "+" : ""}${fmt(pct)}%</td>
      <td></td>
    </tr>`;
  }).join("");
  document.getElementById("portfolio-empty").classList.toggle("hidden", entries.length > 0);

  document.getElementById("cash-amount").textContent = fmtVnd(p.cash);
  document.getElementById("stock-value").textContent = fmtVnd(stockValue);
  document.getElementById("total-asset").textContent = fmtVnd(p.cash + stockValue);
  const pnl = p.cash + stockValue - START_CASH;
  const pnlEl = document.getElementById("pnl");
  pnlEl.textContent = `${pnl >= 0 ? "+" : ""}${fmtVnd(pnl)} (${((pnl / START_CASH) * 100).toFixed(2)}%)`;
  pnlEl.className = pnl >= 0 ? "up" : "down";

  document.getElementById("trades-body").innerHTML =
    p.trades.slice().reverse().slice(0, 50).map((t) => `
      <tr><td>${new Date(t.time).toLocaleString("vi-VN")}</td>
      <td><b>${t.code}</b></td>
      <td class="${t.side === "BUY" ? "up" : "down"}">${t.side === "BUY" ? "Mua" : "Bán"}</td>
      <td class="num">${fmt(t.price)}</td>
      <td class="num">${fmt(t.qty, 0)}</td>
      <td class="num">${fmtVnd(toVnd(t.price, t.qty))}</td></tr>`).join("");
  document.getElementById("trades-empty").classList.toggle("hidden", p.trades.length > 0);

  // sổ lệnh chờ khớp
  const pend = p.pending || [];
  document.getElementById("pending-body").innerHTML = pend.map((o) => {
    const ba = bestBidAsk(o.code);
    const baTxt = ba ? `<span class="up">${fmt(ba.bid)}</span> / <span class="down">${fmt(ba.ask)}</span>` : "--";
    return `<tr>
      <td>${new Date(o.time).toLocaleTimeString("vi-VN")}</td>
      <td><b>${o.code}</b></td>
      <td class="${o.side === "BUY" ? "up" : "down"}">${o.side === "BUY" ? "Mua" : "Bán"}</td>
      <td class="num">${fmt(o.price)}</td>
      <td class="num">${fmt(o.qty - o.filled, 0)}</td>
      <td class="num">${fmt(o.filled, 0)}</td>
      <td class="num">${baTxt}</td>
      <td><button class="cancel-btn" data-cancel="${o.id}">Hủy</button></td>
    </tr>`;
  }).join("");
  document.getElementById("pending-empty").classList.toggle("hidden", pend.length > 0);
}

function renderAll() { renderSummary(); renderTable(); renderPortfolio(); fillSymbolList(); }

/* ---------------- Tải dữ liệu ---------------- */
async function loadAll() {
  State.prevQuotes = new Map(State.quotes);
  try {
    const [hose, hnx, upcom] = await Promise.all([
      loadLatestFloorData("HOSE"),
      loadLatestFloorData("HNX"),
      loadLatestFloorData("UPCOM"),
    ]);
    const merged = new Map([...hose.rows, ...hnx.rows, ...upcom.rows]);
    if (merged.size === 0) throw new Error("Không nhận được dữ liệu từ API");
    State.quotes = merged;
    State.sessionDate = hose.date || hnx.date || upcom.date;
    State.allCodes = new Set([...merged.keys()]);
    matchPendingOrders();
    renderAll();
    applyFlash();
  } catch (err) {
    console.error(err);
    document.getElementById("loading").textContent =
      "Không tải được dữ liệu: " + err.message + " — kiểm tra kết nối mạng hoặc thử lại sau.";
  }
  marketStatus();
}

/* ---------------- Watchlist ---------------- */
function toggleStar(code) {
  const i = State.watchlist.indexOf(code);
  if (i >= 0) State.watchlist.splice(i, 1);
  else State.watchlist.push(code);
  saveWatchlist();
  renderAll();
}

/* ---------------- Giả lập đặt lệnh (có sổ lệnh chờ khớp) ---------------- */
// Sổ cung–cầu giả lập quanh giá đóng cửa gần nhất: spread ±1 tick (0.05)
// Lệnh chờ được đối chiếu lại mỗi chu kỳ refresh khi thị trường mở cửa.
function bestBidAsk(code) {
  const r = State.quotes.get(code);
  if (!r) return null;
  return { bid: r.close - 0.05, ask: r.close + 0.05, ref: r };
}

function placeOrder() {
  const code = document.getElementById("order-symbol").value.trim().toUpperCase();
  const side = document.getElementById("order-side").value;
  const price = parseFloat(document.getElementById("order-price").value);
  const qty = parseInt(document.getElementById("order-qty").value, 10);
  const msg = document.getElementById("order-msg");
  const fail = (t) => { msg.textContent = "❌ " + t; msg.className = "order-msg err"; };

  if (!isMarketOpenNow())
    return fail("Thị trường đang đóng cửa — chỉ được đặt lệnh từ 9:00 đến 15:00 các ngày T2–T6 (giờ VN).");
  if (!State.quotes.has(code)) return fail("Không tìm thấy mã " + code);
  const r = State.quotes.get(code);
  if (!price || price <= 0) return fail("Giá không hợp lệ");
  if (price > r.ceilingPrice + 0.001 || price < r.floorPrice - 0.001)
    return fail(`Giá phải trong biên độ ${fmt(r.floorPrice)} – ${fmt(r.ceilingPrice)}`);
  if (!qty || qty <= 0 || qty % 100 !== 0) return fail("Khối lượng phải là bội số của 100");

  const p = State.portfolio;
  p.pending = p.pending || [];

  if (side === "BUY") {
    const cost = toVnd(price, qty);
    if (cost > p.cash) return fail("Không đủ tiền mặt (cần " + fmtVnd(cost) + ")");
    p.cash -= cost; // tạm giữ tiền cho đến khi khớp / hủy
  } else {
    const h = p.holdings[code];
    const available = h ? h.qty - (h.frozen || 0) : 0;
    if (available < qty) return fail("Không đủ cổ phiếu khả dụng để bán (khả dụng: " + available + ")");
    h.frozen = (h.frozen || 0) + qty; // tạm giữ cổ phiếu
  }

  p.pending.push({ id: Date.now(), code, side, price, qty, filled: 0, time: Date.now() });
  savePortfolio();
  msg.textContent = `✅ Lệnh ${side === "BUY" ? "mua" : "bán"} ${qty} ${code} @ ${fmt(price)} đã vào sổ chờ khớp.`;
  msg.className = "order-msg ok";
  renderPortfolio();
}

// Đối chiếu lệnh chờ với sổ cung–cầu; chỉ chạy khi thị trường mở cửa.
// Mỗi chu kỳ: xác suất khớp 60% (mô phỏng thanh khoản), có thể khớp một phần.
function matchPendingOrders() {
  if (!isMarketOpenNow() || !State.quotes.size) return;
  const p = State.portfolio;
  p.pending = p.pending || [];
  let changed = false;

  for (const o of p.pending) {
    if (o.filled >= o.qty) continue;
    const ba = bestBidAsk(o.code);
    if (!ba) continue;
    if (Math.random() > 0.6) continue; // chưa có lệnh đối ứng trong chu kỳ này

    let fillPrice = null;
    if (o.side === "BUY") {
      if (o.price >= ba.ask) fillPrice = ba.ask;                 // mua cao hơn ask -> khớp giá ask (ưu tiên giá tốt hơn)
      else if (o.price >= ba.ref.close - 0.001) fillPrice = ba.ref.close; // mua bằng giá thị trường -> khớp tại đó
    } else {
      if (o.price <= ba.bid) fillPrice = ba.bid;                 // bán thấp hơn bid -> khớp giá bid
      else if (o.price <= ba.ref.close + 0.001) fillPrice = ba.ref.close; // bán bằng giá thị trường -> khớp tại đó
    }
    if (fillPrice == null) continue;

    // khớp toàn bộ hoặc một phần (≥50%, bội số 100)
    const remain = o.qty - o.filled;
    let fillQty = remain;
    if (remain > 100 && Math.random() < 0.35) {
      fillQty = Math.max(100, Math.floor(remain / 2 / 100) * 100);
    }
    o.filled += fillQty;
    changed = true;

    if (o.side === "BUY") {
      // tiền đã được tạm giữ theo giá đặt từ lúc vào sổ -> chỉ hoàn phần chênh lệch giá khớp tốt hơn
      p.cash += toVnd(o.price - fillPrice, fillQty);
      const h = p.holdings[o.code] || { qty: 0, avgCost: 0 };
      // avgCost giữ đơn vị nghìn đồng như bảng giá
      h.avgCost = (h.avgCost * h.qty + fillPrice * fillQty) / (h.qty + fillQty);
      h.qty += fillQty;
      p.holdings[o.code] = h;
    } else {
      const h = p.holdings[o.code];
      h.qty -= fillQty;
      h.frozen = Math.max(0, (h.frozen || 0) - fillQty);
      p.cash += toVnd(fillPrice, fillQty);
    }
    p.trades.push({ code: o.code, side: o.side, price: fillPrice, qty: fillQty, time: Date.now() });
  }

  p.pending = p.pending.filter((o) => o.filled < o.qty);
  if (changed) savePortfolio();
}

function cancelPending(id) {
  const p = State.portfolio;
  const o = p.pending.find((x) => x.id === id);
  if (!o) return;
  if (o.side === "BUY") {
    // hoàn tiền: phần chưa khớp theo giá đặt (phần đã khớp đã xử lý khi khớp)
    p.cash += toVnd(o.price, o.qty - o.filled);
  } else {
    const h = p.holdings[o.code];
    if (h) h.frozen = Math.max(0, (h.frozen || 0) - (o.qty - o.filled));
  }
  p.pending = p.pending.filter((x) => x.id !== id);
  savePortfolio();
  renderPortfolio();
}

/* ---------------- Biểu đồ nến ---------------- */
const Chart = {
  draw(rows, code) {
    const canvas = document.getElementById("candle-chart");
    const ctx = canvas.getContext("2d");
    const W = 880, H = 380;
    canvas.width = W; canvas.height = H;
    const padL = 56, padR = 12, padT = 24, volH = 70, padB = 26;
    const priceH = H - padT - volH - padB;
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, W, H);
    if (!rows.length) {
      ctx.fillStyle = "#8b949e"; ctx.textAlign = "center";
      ctx.fillText("Không có dữ liệu lịch sử", W / 2, H / 2);
      return;
    }

    const data = rows.slice(-180);
    let max = Math.max(...data.map((r) => r.high));
    let min = Math.min(...data.map((r) => r.low));
    const pad = (max - min) * 0.06 || 0.5; max += pad; min -= pad;
    const maxVol = Math.max(...data.map((r) => (r.nmVolume || 0) + (r.ptVolume || 0))) || 1;

    const n = data.length;
    const plotW = W - padL - padR;
    const step = plotW / n;
    const cw = Math.max(2, Math.min(12, step * 0.65));
    const y = (v) => padT + ((max - v) / (max - min)) * priceH;

    ctx.font = "11px Segoe UI"; ctx.textAlign = "right";
    ctx.strokeStyle = "#21262d"; ctx.fillStyle = "#8b949e";
    for (let i = 0; i <= 5; i++) {
      const v = min + ((max - min) * i) / 5;
      const yy = y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(fmt(v), padL - 6, yy + 4);
    }

    data.forEach((r, i) => {
      const cx = padL + i * step + step / 2;
      const up = r.close >= r.open;
      const color = up ? "#26a69a" : "#ef5350";
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx, y(r.high)); ctx.lineTo(cx, y(r.low)); ctx.stroke();
      const yO = y(r.open), yC = y(r.close);
      const top = Math.min(yO, yC), hgt = Math.max(1.5, Math.abs(yC - yO));
      ctx.fillRect(cx - cw / 2, top, cw, hgt);
      const vol = (r.nmVolume || 0) + (r.ptVolume || 0);
      const vh = (vol / maxVol) * (volH - 8);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(cx - cw / 2, H - padB - vh, cw, vh);
      ctx.globalAlpha = 1;
    });

    // MA20
    if (n > 20) {
      ctx.strokeStyle = "#f5c518"; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let i = 19; i < n; i++) {
        const avg = data.slice(i - 19, i + 1).reduce((s, r) => s + r.close, 0) / 20;
        const cx = padL + i * step + step / 2;
        i === 19 ? ctx.moveTo(cx, y(avg)) : ctx.lineTo(cx, y(avg));
      }
      ctx.stroke(); ctx.lineWidth = 1;
    }

    ctx.fillStyle = "#8b949e"; ctx.textAlign = "center";
    const lblEvery = Math.max(1, Math.round(n / 7));
    data.forEach((r, i) => {
      if (i % lblEvery === 0) ctx.fillText(r.date.slice(5), padL + i * step + step / 2, H - 8);
    });

    const last = data[n - 1];
    ctx.fillStyle = "#e6edf3"; ctx.textAlign = "left";
    ctx.fillText(
      `${code}  O:${fmt(last.open)} H:${fmt(last.high)} L:${fmt(last.low)} C:${fmt(last.close)}  KL:${fmtVol((last.nmVolume || 0) + (last.ptVolume || 0))}`,
      padL, 14
    );
  },
};

/* ---------------- Chi tiết cổ phiếu ---------------- */
const RANGES = { "1M": 25, "3M": 70, "6M": 135, "1Y": 260 };

const Detail = {
  code: null, range: "1M", loading: false,
  async open(code) {
    this.code = code;
    document.getElementById("modal").classList.remove("hidden");
    const r = State.quotes.get(code) || {};
    const cls = classify(r);
    document.getElementById("detail-title").textContent =
      code + (r.floor ? ` — ${r.floor}` : "");
    const priceEl = document.getElementById("detail-price");
    priceEl.textContent = fmt(r.close);
    priceEl.className = "detail-price " + cls;
    this.renderStats(r);
    await this.loadHistory();
  },
  async loadHistory() {
    if (this.loading) return;
    this.loading = true;
    try {
      const rows = await fetchHistory(this.code, RANGES[this.range]);
      Chart.draw(rows, this.code);
    } catch (e) {
      console.error(e);
      Chart.draw([], this.code);
    }
    this.loading = false;
  },
  renderStats(r) {
    const stats = [
      ["Trần", fmt(r.ceilingPrice), "down"],
      ["Sàn", fmt(r.floorPrice), "up"],
      ["Tham chiếu", fmt(r.basicPrice), "ref"],
      ["Mở cửa", fmt(r.open), ""],
      ["Cao nhất", fmt(r.high), "up"],
      ["Thấp nhất", fmt(r.low), "down"],
      ["KL khớp lệnh", fmtVol((r.nmVolume || 0) + (r.ptVolume || 0)), ""],
      ["GT khớp lệnh", r.nmValue != null ? fmtVnd(r.nmValue + (r.ptValue || 0)) : "--", ""],
      ["Giá TB phiên", fmt(r.average), ""],
      ["Phiên", r.date || "--", ""],
    ];
    document.getElementById("detail-stats").innerHTML = stats.map(([k, v, c]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`).join("");
  },
  close() { document.getElementById("modal").classList.add("hidden"); },
};

/* ---------------- Sự kiện ---------------- */
document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    State.view = b.dataset.view;
    ["dashboard", "watchlist", "portfolio"].forEach((v) =>
      document.getElementById("view-" + v).classList.toggle("hidden", v !== State.view));
    renderAll();
  })
);

document.querySelectorAll("#floor-tabs .tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll("#floor-tabs .tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    State.floor = t.dataset.floor;
    renderTable();
  })
);

document.getElementById("search-box").addEventListener("input", renderTable);

document.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) { e.stopPropagation(); toggleStar(star.dataset.star); return; }
  const tr = e.target.closest("tr[data-code]");
  if (tr && tr.dataset.view !== "portfolio") Detail.open(tr.dataset.code);
});

document.querySelectorAll(".chart-tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".chart-tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    Detail.range = t.dataset.range;
    Detail.loadHistory();
  })
);

document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") Detail.close();
});
document.getElementById("place-order").addEventListener("click", placeOrder);
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cancel]");
  if (btn) cancelPending(Number(btn.dataset.cancel));
});
document.getElementById("order-symbol").addEventListener("change", (e) => {
  const r = State.quotes.get(e.target.value.trim().toUpperCase());
  if (r) document.getElementById("order-price").value = r.close.toFixed(2);
});

function fillSymbolList() {
  document.getElementById("symbol-list").innerHTML =
    [...State.allCodes].sort().map((c) => `<option value="${c}">`).join("");
}

/* ---------------- Khởi động ---------------- */
loadAll();
setInterval(loadAll, REFRESH_MS);
setInterval(marketStatus, 30000);
