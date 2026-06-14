"use strict";

const PAGE_SIZE = 30;

const state = {
  data: null,
  view: "all",
  search: "",
  brand: "all",
  region: "all",
  sort: "brand",
  connected: false,
  chartKey: "goldSpot",
  timeframe: "5m",
  windowSize: "all",
  chartHover: null,
  chartRender: null,
  tableTooltip: null,
  pages: {
    gold: 1,
    silver: 1,
    world: 1
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  liveDot: $("#liveDot"),
  liveText: $("#liveText"),
  refreshMeta: $("#refreshMeta"),
  sourceSummary: $("#sourceSummary"),
  manualRefresh: $("#manualRefresh"),
  searchInput: $("#searchInput"),
  brandFilter: $("#brandFilter"),
  regionFilter: $("#regionFilter"),
  sortSelect: $("#sortSelect"),
  goldTable: $("#goldTable"),
  silverTable: $("#silverTable"),
  worldTable: $("#worldTable"),
  goldPager: $("#goldPager"),
  silverPager: $("#silverPager"),
  worldPager: $("#worldPager"),
  sourceGrid: $("#sourceGrid"),
  movementGrid: $("#movementGrid"),
  errorBox: $("#errorBox"),
  goldCount: $("#goldCount"),
  silverCount: $("#silverCount"),
  worldCount: $("#worldCount"),
  sourceCount: $("#sourceCount"),
  metricSjc: $("#metricSjc"),
  metricSjcSub: $("#metricSjcSub"),
  metricGoldSpot: $("#metricGoldSpot"),
  metricGoldSpotSub: $("#metricGoldSpotSub"),
  metricSilver: $("#metricSilver"),
  metricSilverSub: $("#metricSilverSub"),
  metricSources: $("#metricSources"),
  metricSourcesSub: $("#metricSourcesSub"),
  terminalTitle: $("#terminalTitle"),
  terminalMeta: $("#terminalMeta"),
  ohlcStrip: $("#ohlcStrip"),
  terminalClock: $("#terminalClock"),
  quoteSymbol: $("#quoteSymbol"),
  quoteName: $("#quoteName"),
  quotePrice: $("#quotePrice"),
  quoteChange: $("#quoteChange"),
  quoteStatus: $("#quoteStatus"),
  quoteBid: $("#quoteBid"),
  quoteAsk: $("#quoteAsk"),
  dayLow: $("#dayLow"),
  dayHigh: $("#dayHigh"),
  dayMarker: $("#dayMarker"),
  seriesLow: $("#seriesLow"),
  seriesHigh: $("#seriesHigh"),
  seriesMarker: $("#seriesMarker"),
  performanceGrid: $("#performanceGrid"),
  chart: $("#priceChart")
};

const CHART_CONFIG = {
  goldSpot: {
    symbol: "XAUUSD",
    title: "Vàng / Đô la Mỹ",
    market: "FX_IDC",
    unitType: "usd",
    digits: 3,
    tint: "#089981"
  },
  sjcSell: {
    symbol: "SJC",
    title: "Vàng SJC bán ra",
    market: "Việt Nam",
    unitType: "vnd",
    digits: 0,
    tint: "#b98213"
  },
  silverSellLuong: {
    symbol: "SILVER",
    title: "Bạc quy đổi/lượng",
    market: "Việt Nam",
    unitType: "vnd",
    digits: 0,
    tint: "#64748b"
  }
};

const TIMEFRAME_MINUTES = {
  "1m": 1,
  "5m": 5,
  "30m": 30,
  "1h": 60
};

function formatMoney(value, unit = "") {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const number = Number(value);
  const compact = Math.abs(number) >= 1_000_000
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000_000) + " tr"
    : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(number);
  return unit ? `${compact} ${unit}` : compact;
}

function formatPlain(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(Number(value));
}

function formatTerminalPrice(value, unitType, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  if (unitType === "usd") {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(Number(value));
  }
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0
  }).format(Number(value));
}

function formatAxisPrice(value, unitType) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  if (unitType === "usd") {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(Number(value));
  }
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(value) / 1_000_000)}tr`;
}

function formatDate(value, fallback = "") {
  if (!value) return fallback || "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback || "--";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tooltipEscape(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

function setLive(connected, text) {
  state.connected = connected;
  els.liveDot.classList.toggle("live", connected);
  els.liveText.textContent = text;
}

function uniqueOptions(rows, key) {
  const values = Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)));
  return values.sort((a, b) => a.localeCompare(b, "vi"));
}

function updateSelect(select, values, current, allLabel) {
  const nextValues = ["all", ...values];
  if (!nextValues.includes(current)) current = "all";
  select.innerHTML = nextValues
    .map((value) => `<option value="${escapeHtml(value)}">${value === "all" ? allLabel : escapeHtml(value)}</option>`)
    .join("");
  select.value = current;
  return current;
}

function rowMatches(row) {
  const query = state.search.trim().toLocaleLowerCase("vi-VN");
  if (state.brand !== "all" && row.brand !== state.brand) return false;
  if (state.region !== "all" && row.region !== state.region) return false;
  if (!query) return true;
  return [
    row.brand,
    row.region,
    row.product,
    row.source,
    row.name,
    row.market,
    row.unit
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("vi-VN")
    .includes(query);
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (state.sort === "sellDesc") return (b.sell ?? b.last ?? -Infinity) - (a.sell ?? a.last ?? -Infinity);
    if (state.sort === "sellAsc") return (a.sell ?? a.last ?? Infinity) - (b.sell ?? b.last ?? Infinity);
    if (state.sort === "spreadAsc") return (a.spread ?? Infinity) - (b.spread ?? Infinity);
    return [a.brand, a.region, a.product].join("|").localeCompare([b.brand, b.region, b.product].join("|"), "vi");
  });
}

function isPrimarySjcRow(row) {
  return row?.brand === "SJC" &&
    row.sell != null &&
    /Vàng SJC/i.test(row.product || "") &&
    /1L|10L|1KG/i.test(row.product || "");
}

function resetTablePages() {
  state.pages.gold = 1;
  state.pages.silver = 1;
  state.pages.world = 1;
}

function getPageRows(rows, tableKey) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.pages[tableKey] = Math.min(Math.max(1, state.pages[tableKey]), totalPages);
  const start = (state.pages[tableKey] - 1) * PAGE_SIZE;
  return {
    rows: rows.slice(start, start + PAGE_SIZE),
    page: state.pages[tableKey],
    totalPages,
    totalRows: rows.length,
    start: rows.length ? start + 1 : 0,
    end: Math.min(start + PAGE_SIZE, rows.length)
  };
}

function renderPager(container, tableKey, pageInfo) {
  if (!container) return;
  container.innerHTML = `
    <span>Trang ${pageInfo.page}/${pageInfo.totalPages} · Hiện ${pageInfo.start}-${pageInfo.end} / ${pageInfo.totalRows} dòng</span>
    <div class="pager-actions">
      <button type="button" data-page-table="${tableKey}" data-page-action="prev" ${pageInfo.page <= 1 ? "disabled" : ""}>Trước</button>
      <button type="button" data-page-table="${tableKey}" data-page-action="next" ${pageInfo.page >= pageInfo.totalPages ? "disabled" : ""}>Tiếp theo</button>
    </div>
  `;
}

function filteredGoldRows() {
  return sortRows((state.data?.domesticGold || []).filter(rowMatches));
}

function filteredSilverRows() {
  return (state.data?.silver || []).filter(rowMatches);
}

function filteredWorldRows() {
  return (state.data?.world || []).filter(rowMatches);
}

function renderMetrics() {
  const data = state.data;
  if (!data) return;

  const sjc = data.domesticGold.find((row) => isPrimarySjcRow(row) && /hồ chí minh|toàn quốc/i.test(row.region))
    || data.domesticGold.find(isPrimarySjcRow)
    || data.domesticGold.find((row) => row.brand === "SJC" && row.sell != null)
    || data.domesticGold.find((row) => row.sell != null);
  const goldSpot = data.world.find((row) => row.metal === "gold" && row.unit === "USD/oz" && row.last != null);
  const silverLuong = data.silver.find((row) => row.currency === "VND" && /Lượng/i.test(row.product));

  els.metricSjc.textContent = formatMoney(sjc?.sell, "đ");
  els.metricSjcSub.textContent = sjc ? `${sjc.brand} · ${sjc.region} · ${sjc.product}` : "Chưa có dữ liệu";

  els.metricGoldSpot.textContent = goldSpot ? `${formatPlain(goldSpot.last)} USD` : "--";
  els.metricGoldSpotSub.textContent = goldSpot ? `${goldSpot.product} · ${goldSpot.source}` : "Chưa có dữ liệu";

  els.metricSilver.textContent = formatMoney(silverLuong?.sell, "đ");
  els.metricSilverSub.textContent = silverLuong ? `${silverLuong.product} · ${silverLuong.source}` : "Chưa có dữ liệu";

  els.metricSources.textContent = `${data.stats.okSources}/${data.sources.length}`;
  els.metricSourcesSub.textContent = data.stats.failedSources ? `${data.stats.failedSources} nguồn lỗi` : "Tất cả nguồn đang phản hồi";
}

function buildGoldReference(row) {
  return [
    `${row.brand} · ${row.region}`,
    row.product,
    `Mua: ${formatMoney(row.buy, "đ")} | Bán: ${formatMoney(row.sell, "đ")}`,
    `Chênh lệch: ${formatMoney(row.spread, "đ")} · Đơn vị: ${row.unit}`,
    `Cập nhật: ${formatDate(row.updatedAt, row.updatedAtRaw)}`,
    `Nguồn: ${row.source} · ${row.sourceUrl}`
  ].join("\n");
}

function buildSilverReference(row) {
  const buy = row.currency === "USD" ? `${formatPlain(row.buy, 3)} USD` : formatMoney(row.buy, "đ");
  const sell = row.sell == null ? "--" : row.currency === "USD" ? `${formatPlain(row.sell, 3)} USD` : formatMoney(row.sell, "đ");
  return [
    `${row.source} · ${row.region}`,
    row.product,
    `Mua: ${buy} | Bán: ${sell}`,
    `Đơn vị: ${row.unit}`,
    `Cập nhật: ${formatDate(row.updatedAt, row.updatedAtRaw)}`,
    `Nguồn: ${row.sourceUrl}`
  ].join("\n");
}

function buildWorldReference(row) {
  return [
    `${row.name || row.metal} · ${row.product}`,
    `Thị trường: ${row.market || "--"}`,
    `Giá cuối: ${row.unit?.startsWith("VND") ? formatMoney(row.last, "đ") : formatPlain(row.last, 3)}`,
    `Thay đổi: ${row.change == null ? "--" : `${formatPlain(row.change, 3)} (${formatPlain(row.changePct, 2)}%)`}`,
    `Đơn vị: ${row.unit}`,
    `Nguồn: ${row.source} · ${row.sourceUrl}`
  ].join("\n");
}

function renderGoldTable() {
  const rows = filteredGoldRows();
  const pageInfo = getPageRows(rows, "gold");
  els.goldCount.textContent = `${rows.length} dòng`;
  renderPager(els.goldPager, "gold", pageInfo);
  els.goldTable.innerHTML = pageInfo.rows.map((row) => `
    <tr data-reference="${tooltipEscape(buildGoldReference(row))}">
      <td><span class="pill">${escapeHtml(row.brand)}</span></td>
      <td>${escapeHtml(row.region)}</td>
      <td>${escapeHtml(row.product)}</td>
      <td class="number">${formatMoney(row.buy, "đ")}</td>
      <td class="number">${formatMoney(row.sell, "đ")}</td>
      <td class="number">${formatMoney(row.spread, "đ")}</td>
      <td>${formatDate(row.updatedAt, row.updatedAtRaw)}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">Không có dòng phù hợp bộ lọc.</td></tr>`;
}

function renderSilverTable() {
  const rows = filteredSilverRows();
  const pageInfo = getPageRows(rows, "silver");
  els.silverCount.textContent = `${rows.length} dòng`;
  renderPager(els.silverPager, "silver", pageInfo);
  els.silverTable.innerHTML = pageInfo.rows.map((row) => `
    <tr data-reference="${tooltipEscape(buildSilverReference(row))}">
      <td><span class="pill">${escapeHtml(row.source)}</span></td>
      <td>${escapeHtml(row.region)}</td>
      <td>${escapeHtml(row.product)}</td>
      <td class="number">${row.currency === "USD" ? formatPlain(row.buy, 3) : formatMoney(row.buy, "đ")}</td>
      <td class="number">${row.sell == null ? "--" : row.currency === "USD" ? formatPlain(row.sell, 3) : formatMoney(row.sell, "đ")}</td>
      <td>${escapeHtml(row.unit)}</td>
      <td>${formatDate(row.updatedAt, row.updatedAtRaw)}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">Không có dòng phù hợp bộ lọc.</td></tr>`;
}

function renderWorldTable() {
  const rows = filteredWorldRows();
  const pageInfo = getPageRows(rows, "world");
  els.worldCount.textContent = `${rows.length} dòng`;
  renderPager(els.worldPager, "world", pageInfo);
  els.worldTable.innerHTML = pageInfo.rows.map((row) => `
    <tr data-reference="${tooltipEscape(buildWorldReference(row))}">
      <td>${escapeHtml(row.name || row.metal)}</td>
      <td><span class="pill">${escapeHtml(row.product)}</span></td>
      <td class="number">${row.unit?.startsWith("VND") ? formatMoney(row.last, "đ") : formatPlain(row.last, 3)}</td>
      <td class="number">${row.change == null ? "--" : `${formatPlain(row.change, 3)} (${formatPlain(row.changePct, 2)}%)`}</td>
      <td>${escapeHtml(row.unit)}</td>
      <td>${escapeHtml(row.source)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Không có dòng phù hợp bộ lọc.</td></tr>`;
}

function renderSources() {
  const data = state.data;
  if (!data) return;
  els.sourceCount.textContent = `${data.sources.length} nguồn`;
  els.errorBox.classList.toggle("hidden", !data.errors.length);
  els.errorBox.innerHTML = data.errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");
  els.sourceGrid.innerHTML = data.sources.map((source) => `
    <article class="source-card">
      <div><span class="pill ${source.ok ? "ok" : "bad"}">${source.ok ? "OK" : "Lỗi"}</span></div>
      <strong>${escapeHtml(source.name)}</strong>
      <span>${source.rowCount} dòng · ${source.durationMs} ms</span>
      <span>${source.updatedAtRaw ? escapeHtml(source.updatedAtRaw) : "Không có mốc cập nhật từ nguồn"}</span>
      ${source.error ? `<span class="bad-text">${escapeHtml(source.error)}</span>` : ""}
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a>
    </article>
  `).join("");
}

function getChartPoints() {
  const now = Date.now();
  const windowMs = {
    "1d": 24 * 60 * 60 * 1000,
    "5d": 5 * 24 * 60 * 60 * 1000,
    "1m": 30 * 24 * 60 * 60 * 1000,
    "3m": 90 * 24 * 60 * 60 * 1000,
    all: Infinity
  }[state.windowSize] || Infinity;

  return (state.data?.history || [])
    .map((point) => ({
      t: point.t,
      time: new Date(point.t).getTime(),
      value: Number(point[state.chartKey])
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .filter((point) => windowMs === Infinity || now - point.time <= windowMs)
    .sort((a, b) => a.time - b.time);
}

function buildCandles(points) {
  const minutes = TIMEFRAME_MINUTES[state.timeframe] || 5;
  const interval = minutes * 60 * 1000;
  const buckets = [];

  for (const point of points) {
    const bucketTime = Math.floor(point.time / interval) * interval;
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.bucketTime !== bucketTime) {
      bucket = { bucketTime, points: [] };
      buckets.push(bucket);
    }
    bucket.points.push(point);
  }

  let previousClose = null;
  return buckets.map((bucket) => {
    const values = bucket.points.map((point) => point.value);
    const first = values[0];
    const close = values[values.length - 1];
    const open = bucket.points.length === 1 && previousClose != null ? previousClose : first;
    const high = Math.max(open, ...values);
    const low = Math.min(open, ...values);
    const volume = Math.max(0.8, Math.abs(close - open) / Math.max(Math.abs(open), 1) * 100000);
    previousClose = close;
    return {
      time: bucket.points[bucket.points.length - 1].time,
      open,
      high,
      low,
      close,
      volume
    };
  });
}

function visibleCandles(candles) {
  return candles.slice(-90);
}

function updateChartControls() {
  $$(".symbol-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.chartKey === state.chartKey);
  });
  $$("[data-timeframe]").forEach((button) => {
    button.classList.toggle("active", button.dataset.timeframe === state.timeframe);
  });
  $$("[data-window-size]").forEach((button) => {
    button.classList.toggle("active", button.dataset.windowSize === state.windowSize);
  });
}

function updateTerminalPanel(candles) {
  const config = CHART_CONFIG[state.chartKey];
  const latest = candles.at(-1);
  if (!latest) {
    els.terminalTitle.textContent = `${config.title} · ${state.timeframe.replace("m", "")} · ${config.market}`;
    els.terminalMeta.textContent = "Đang chờ dữ liệu lịch sử";
    els.ohlcStrip.innerHTML = "";
    els.quoteSymbol.textContent = config.symbol;
    els.quoteName.textContent = `${config.title} · ${config.market}`;
    els.quotePrice.textContent = "--";
    els.quoteChange.textContent = "--";
    els.quoteStatus.textContent = "Chưa có đủ dữ liệu";
    els.quoteBid.textContent = "--";
    els.quoteAsk.textContent = "--";
    els.dayLow.textContent = "--";
    els.dayHigh.textContent = "--";
    els.seriesLow.textContent = "--";
    els.seriesHigh.textContent = "--";
    els.performanceGrid.innerHTML = "";
    return;
  }
  const previous = candles.at(-2);
  const change = latest && previous ? latest.close - previous.close : 0;
  const changePct = previous?.close ? (change / previous.close) * 100 : 0;
  const tone = movementTone(change);
  const values = candles.flatMap((candle) => [candle.high, candle.low]);
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const position = high && low && high !== low ? ((latest.close - low) / (high - low)) * 100 : 50;
  const spread = latest ? Math.max(Math.abs(latest.close - latest.open) * 0.2, latest.close * 0.00015) : 0;

  els.terminalTitle.textContent = `${config.title} · ${state.timeframe.replace("m", "")} · ${config.market}`;
  els.terminalMeta.textContent = `Biến động ${formatPlain(latest?.volume, 2)} · cập nhật ${latest ? formatTime(latest.time) : "--"}`;
  els.ohlcStrip.innerHTML = latest ? `
    <span>O ${formatTerminalPrice(latest.open, config.unitType, config.digits)}</span>
    <span>H ${formatTerminalPrice(latest.high, config.unitType, config.digits)}</span>
    <span>L ${formatTerminalPrice(latest.low, config.unitType, config.digits)}</span>
    <span>C ${formatTerminalPrice(latest.close, config.unitType, config.digits)}</span>
    <b class="${tone}">${change >= 0 ? "+" : ""}${formatTerminalPrice(change, config.unitType, config.unitType === "usd" ? 3 : 0)} (${changePct >= 0 ? "+" : ""}${formatPlain(changePct, 2)}%)</b>
  ` : "";

  els.quoteSymbol.textContent = config.symbol;
  els.quoteName.textContent = `${config.title} · ${config.market}`;
  els.quotePrice.textContent = latest ? `${formatTerminalPrice(latest.close, config.unitType, config.digits)} ${config.unitType === "usd" ? "USD" : "VND"}` : "--";
  els.quoteChange.className = `quote-change ${tone}`;
  els.quoteChange.textContent = latest
    ? `${change >= 0 ? "+" : ""}${formatTerminalPrice(change, config.unitType, config.unitType === "usd" ? 3 : 0)}  ${changePct >= 0 ? "+" : ""}${formatPlain(changePct, 2)}%`
    : "--";
  els.quoteStatus.textContent = `Cập nhật lần cuối vào ${latest ? formatTime(latest.time) : "--"}`;
  els.quoteBid.textContent = latest ? formatTerminalPrice(latest.close - spread, config.unitType, config.digits) : "--";
  els.quoteAsk.textContent = latest ? formatTerminalPrice(latest.close + spread, config.unitType, config.digits) : "--";
  els.dayLow.textContent = formatAxisPrice(low, config.unitType);
  els.dayHigh.textContent = formatAxisPrice(high, config.unitType);
  els.seriesLow.textContent = formatAxisPrice(low, config.unitType);
  els.seriesHigh.textContent = formatAxisPrice(high, config.unitType);
  els.dayMarker.style.left = `${Math.max(0, Math.min(100, position))}%`;
  els.seriesMarker.style.left = `${Math.max(0, Math.min(100, position))}%`;
  els.terminalClock.textContent = `${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())} UTC+7`;

  const periods = [
    ["1W", 7],
    ["1M", 30],
    ["3M", 90],
    ["6M", 180],
    ["YTD", 365],
    ["1Y", 365]
  ];
  els.performanceGrid.innerHTML = periods.map(([label, lookback]) => {
    const compare = candles[Math.max(0, candles.length - 1 - Math.min(lookback, candles.length - 1))];
    const pct = compare?.close ? ((latest.close - compare.close) / compare.close) * 100 : 0;
    const itemTone = movementTone(pct);
    return `<span class="${itemTone}">${pct >= 0 ? "+" : ""}${formatPlain(pct, 2)}%<small>${label}</small></span>`;
  }).join("");
}

function renderChart() {
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const config = CHART_CONFIG[state.chartKey];
  const candles = visibleCandles(buildCandles(getChartPoints()));
  updateChartControls();

  if (candles.length < 2) {
    ctx.fillStyle = "#667174";
    ctx.font = "16px Segoe UI, Arial";
    ctx.fillText("Cần ít nhất 2 lần cập nhật để vẽ biểu đồ nến.", 28, 52);
    updateTerminalPanel(candles);
    return;
  }

  updateTerminalPanel(candles);

  const area = { left: 24, right: 92, top: 26, bottom: 78 };
  const chartW = width - area.left - area.right;
  const priceTop = area.top;
  const priceBottom = height - area.bottom - 112;
  const volumeTop = priceBottom + 24;
  const volumeBottom = height - area.bottom;
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const fallbackRange = Math.max(Math.abs(rawMax), 1) * 0.002;
  const range = rawMax - rawMin || fallbackRange;
  const min = rawMin - range * 0.12;
  const max = rawMax + range * 0.12;
  const toY = (value) => priceBottom - ((value - min) / (max - min)) * (priceBottom - priceTop);

  ctx.strokeStyle = "#edf0eb";
  ctx.lineWidth = 1;
  ctx.font = "13px Segoe UI, Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = "#2c2f33";
  for (let i = 0; i <= 8; i += 1) {
    const y = priceTop + ((priceBottom - priceTop) * i) / 8;
    const price = max - ((max - min) * i) / 8;
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(width - area.right, y);
    ctx.stroke();
    ctx.fillText(formatAxisPrice(price, config.unitType), width - 14, y + 4);
  }

  for (let i = 0; i <= 8; i += 1) {
    const x = area.left + (chartW * i) / 8;
    ctx.beginPath();
    ctx.moveTo(x, priceTop);
    ctx.lineTo(x, volumeBottom);
    ctx.stroke();
  }

  const step = chartW / candles.length;
  const candleW = Math.min(14, Math.max(4, step * 0.62));
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const hitboxes = [];

  candles.forEach((candle, index) => {
    const x = area.left + step * index + step / 2;
    const up = candle.close >= candle.open;
    const color = up ? "#089981" : "#f23645";
    const openY = toY(candle.open);
    const closeY = toY(candle.close);
    const highY = toY(candle.high);
    const lowY = toY(candle.low);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(2, Math.abs(closeY - openY));
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

    const volumeH = (candle.volume / maxVolume) * (volumeBottom - volumeTop);
    ctx.globalAlpha = 0.36;
    ctx.fillRect(x - candleW / 2, volumeBottom - volumeH, candleW, volumeH);
    ctx.globalAlpha = 1;
    hitboxes.push({ x, candle, index });
  });

  const latest = candles.at(-1);
  const currentY = toY(latest.close);
  ctx.strokeStyle = "#089981";
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(area.left, currentY);
  ctx.lineTo(width - area.right, currentY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#089981";
  ctx.fillRect(width - area.right + 4, currentY - 12, 82, 24);
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px Segoe UI, Arial";
  ctx.textAlign = "center";
  ctx.fillText(formatAxisPrice(latest.close, config.unitType), width - area.right + 45, currentY + 4);

  ctx.fillStyle = "#2c2f33";
  ctx.textAlign = "center";
  const labelIndexes = [0, Math.floor(candles.length / 4), Math.floor(candles.length / 2), Math.floor(candles.length * 0.75), candles.length - 1];
  [...new Set(labelIndexes)].forEach((index) => {
    const candle = candles[index];
    const x = area.left + step * index + step / 2;
    ctx.fillText(formatTime(candle.time).slice(0, 5), x, height - 36);
  });

  state.chartRender = {
    area,
    width,
    height,
    priceTop,
    priceBottom,
    volumeBottom,
    min,
    max,
    unitType: config.unitType,
    digits: config.digits,
    hitboxes
  };

  if (state.chartHover) {
    drawChartHover(ctx, state.chartHover);
  }
}

function priceFromY(y) {
  const render = state.chartRender;
  if (!render) return null;
  const ratio = (render.priceBottom - y) / (render.priceBottom - render.priceTop);
  return render.min + ratio * (render.max - render.min);
}

function drawLabel(ctx, text, x, y, options = {}) {
  const paddingX = options.paddingX ?? 9;
  const paddingY = options.paddingY ?? 5;
  const font = options.font || "12px Segoe UI, Arial";
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = metrics.width + paddingX * 2;
  const h = 24;
  const left = Math.max(4, Math.min(x, ctx.canvas.width - w - 4));
  const top = Math.max(4, Math.min(y, ctx.canvas.height - h - 4));
  ctx.fillStyle = options.bg || "#111111";
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = options.fg || "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + paddingX, top + h / 2 + (paddingY - paddingY));
  ctx.textBaseline = "alphabetic";
  return { left, top, w, h };
}

function drawChartHover(ctx, hover) {
  const render = state.chartRender;
  if (!render || !hover?.candle) return;
  const { area, width, height, priceTop, volumeBottom, unitType, digits } = render;
  const y = Math.max(priceTop, Math.min(render.priceBottom, hover.y));
  const price = priceFromY(y);

  ctx.save();
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(hover.x, priceTop);
  ctx.lineTo(hover.x, volumeBottom);
  ctx.moveTo(area.left, y);
  ctx.lineTo(width - area.right, y);
  ctx.stroke();
  ctx.setLineDash([]);

  const timeLabel = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "long",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(hover.candle.time));
  drawLabel(ctx, timeLabel, hover.x - 78, height - 32);
  drawLabel(ctx, formatTerminalPrice(price, unitType, digits), width - area.right + 4, y - 12);

  const ohlc = `O ${formatTerminalPrice(hover.candle.open, unitType, digits)}  H ${formatTerminalPrice(hover.candle.high, unitType, digits)}  L ${formatTerminalPrice(hover.candle.low, unitType, digits)}  C ${formatTerminalPrice(hover.candle.close, unitType, digits)}`;
  drawLabel(ctx, ohlc, Math.min(hover.x + 12, width - 360), priceTop + 8, { bg: "rgba(17, 17, 17, 0.92)" });
  ctx.restore();
}

function updateChartHover(event) {
  const render = state.chartRender;
  if (!render) return;
  const rect = els.chart.getBoundingClientRect();
  const scaleX = els.chart.width / rect.width;
  const scaleY = els.chart.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  const nearest = render.hitboxes.reduce((best, item) => {
    const distance = Math.abs(item.x - x);
    return !best || distance < best.distance ? { ...item, distance } : best;
  }, null);

  if (!nearest || x < render.area.left || x > render.width - render.area.right || y < render.priceTop || y > render.volumeBottom) {
    state.chartHover = null;
  } else {
    state.chartHover = { x: nearest.x, y, candle: nearest.candle };
  }
  renderChart();
}

function getMovement(history, key) {
  const points = history
    .map((point) => ({ t: point.t, value: point[key] }))
    .filter((point) => point.value != null);
  const latest = points.at(-1) || null;
  const previous = points.at(-2) || null;
  const previousChanged = latest
    ? [...points].reverse().find((point) => point.t !== latest.t && point.value !== latest.value) || null
    : null;

  return {
    latest,
    previous,
    previousChanged,
    diff: latest && previous ? latest.value - previous.value : null,
    changedDiff: latest && previousChanged ? latest.value - previousChanged.value : null
  };
}

function formatMovementValue(value, unitType) {
  if (value == null) return "--";
  if (unitType === "usd") return `${formatPlain(value, 2)} USD`;
  return formatMoney(value, "đ");
}

function formatMovementDiff(value, base, unitType) {
  if (value == null || base == null) return "--";
  const sign = value > 0 ? "+" : "";
  const pct = base ? (value / base) * 100 : 0;
  if (unitType === "usd") return `${sign}${formatPlain(value, 2)} USD · ${sign}${formatPlain(pct, 2)}%`;
  return `${sign}${formatMoney(value, "đ")} · ${sign}${formatPlain(pct, 2)}%`;
}

function movementTone(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function renderMovements() {
  const history = state.data?.history || [];
  const items = [
    { key: "sjcSell", label: "Vàng SJC bán ra", unitType: "vnd" },
    { key: "goldSpot", label: "Vàng thế giới XAU", unitType: "usd" },
    { key: "silverSellLuong", label: "Bạc quy đổi/lượng", unitType: "vnd" }
  ];

  els.movementGrid.innerHTML = items.map((item) => {
    const movement = getMovement(history, item.key);
    const diffBase = movement.previous?.value ?? null;
    const changedBase = movement.previousChanged?.value ?? null;
    const tone = movementTone(movement.diff ?? 0);
    const changedTone = movementTone(movement.changedDiff ?? 0);
    const previousChangedText = movement.previousChanged
      ? `${formatMovementValue(movement.previousChanged.value, item.unitType)} lúc ${formatTime(movement.previousChanged.t)}`
      : "Chưa ghi nhận lần đổi giá khác";

    return `
      <article class="movement-card">
        <div class="movement-title">
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatMovementValue(movement.latest?.value, item.unitType)}</strong>
        </div>
        <div class="movement-row">
          <span>Trước đó</span>
          <b>${formatMovementValue(movement.previous?.value, item.unitType)}</b>
        </div>
        <div class="movement-row">
          <span>So với lần trước</span>
          <b class="${tone}">${formatMovementDiff(movement.diff, diffBase, item.unitType)}</b>
        </div>
        <div class="movement-row movement-last-change">
          <span>Lần đổi gần nhất</span>
          <b class="${changedTone}">${movement.previousChanged ? formatMovementDiff(movement.changedDiff, changedBase, item.unitType) : "--"}</b>
        </div>
        <small>${escapeHtml(previousChangedText)}</small>
      </article>
    `;
  }).join("");
}

function renderFilters() {
  const rows = [
    ...(state.data?.domesticGold || []),
    ...(state.data?.silver || [])
  ];
  state.brand = updateSelect(els.brandFilter, uniqueOptions(rows, "brand"), state.brand, "Tất cả thương hiệu");
  state.region = updateSelect(els.regionFilter, uniqueOptions(rows, "region"), state.region, "Tất cả khu vực");
}

function applyView() {
  $$(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  $$("[data-section]").forEach((section) => {
    const allowed = section.dataset.section.split(" ");
    section.classList.toggle("hidden", !allowed.includes(state.view));
  });
}

function render() {
  if (!state.data) return;
  applyView();
  renderFilters();
  renderMetrics();
  renderGoldTable();
  renderSilverTable();
  renderWorldTable();
  renderSources();
  renderChart();
  renderMovements();

  const data = state.data;
  els.refreshMeta.textContent = `Cập nhật ${formatDate(data.refreshedAt)} · lần tới ${formatDate(data.nextRefreshAt)}`;
  els.sourceSummary.textContent = `${data.stats.domesticGoldRows} dòng vàng · ${data.stats.silverRows} dòng bạc · ${data.stats.worldRows} dòng thế giới`;
}

function ensureTableTooltip() {
  if (state.tableTooltip) return state.tableTooltip;
  const tooltip = document.createElement("div");
  tooltip.className = "table-reference-tooltip hidden";
  document.body.appendChild(tooltip);
  state.tableTooltip = tooltip;
  return tooltip;
}

function showTableTooltip(text, event) {
  const tooltip = ensureTableTooltip();
  tooltip.textContent = text;
  tooltip.classList.remove("hidden");
  moveTableTooltip(event);
}

function moveTableTooltip(event) {
  const tooltip = state.tableTooltip;
  if (!tooltip || tooltip.classList.contains("hidden")) return;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - offset;
  if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - offset;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTableTooltip() {
  state.tableTooltip?.classList.add("hidden");
}

async function loadInitial() {
  const response = await fetch("/api/prices", { cache: "no-store" });
  state.data = await response.json();
  render();
}

function startStream() {
  if (!window.EventSource) {
    setLive(false, "Trình duyệt không hỗ trợ SSE");
    return;
  }

  const source = new EventSource("/api/stream");
  source.addEventListener("open", () => setLive(true, "Đang realtime"));
  source.addEventListener("error", () => setLive(false, "Mất kết nối, tự nối lại"));
  source.addEventListener("prices", (event) => {
    const payload = JSON.parse(event.data);
    state.data = payload.data;
    setLive(true, payload.event === "error" ? "Realtime có lỗi nguồn" : "Đang realtime");
    render();
  });
}

els.manualRefresh.addEventListener("click", async () => {
  els.manualRefresh.disabled = true;
  els.manualRefresh.textContent = "Đang làm mới";
  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    state.data = await response.json();
    render();
  } finally {
    els.manualRefresh.disabled = false;
    els.manualRefresh.textContent = "Làm mới ngay";
  }
});

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  resetTablePages();
  render();
});

els.brandFilter.addEventListener("change", (event) => {
  state.brand = event.target.value;
  resetTablePages();
  render();
});

els.regionFilter.addEventListener("change", (event) => {
  state.region = event.target.value;
  resetTablePages();
  render();
});

els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  resetTablePages();
  render();
});

document.addEventListener("click", (event) => {
  const chartButton = event.target.closest("[data-chart-key]");
  if (chartButton) {
    state.chartKey = chartButton.dataset.chartKey;
    renderChart();
    return;
  }

  const timeframeButton = event.target.closest("[data-timeframe]");
  if (timeframeButton) {
    state.timeframe = timeframeButton.dataset.timeframe;
    renderChart();
    return;
  }

  const windowButton = event.target.closest("[data-window-size]");
  if (windowButton) {
    state.windowSize = windowButton.dataset.windowSize;
    renderChart();
    return;
  }

  const button = event.target.closest("[data-page-table]");
  if (!button) return;
  const tableKey = button.dataset.pageTable;
  const action = button.dataset.pageAction;
  if (!state.pages[tableKey]) return;
  state.pages[tableKey] += action === "next" ? 1 : -1;
  render();
});

document.addEventListener("mousemove", (event) => {
  const row = event.target.closest("tr[data-reference]");
  if (!row) {
    hideTableTooltip();
    return;
  }
  showTableTooltip(row.dataset.reference, event);
});

document.addEventListener("mouseleave", hideTableTooltip);

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

els.chart.addEventListener("mousemove", updateChartHover);
els.chart.addEventListener("mouseleave", () => {
  state.chartHover = null;
  renderChart();
});

window.addEventListener("resize", renderChart);

loadInitial()
  .catch((error) => {
    setLive(false, error.message || "Không tải được dữ liệu");
  })
  .finally(startStream);
