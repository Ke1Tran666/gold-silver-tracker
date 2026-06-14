"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { URL } = require("node:url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4587);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15_000);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 1440);
const PUBLIC_DIR = path.join(__dirname, "public");
const HISTORY_FILE = process.env.HISTORY_FILE || path.join(__dirname, "data", "price-history.json");

const PRICE_PATTERN = "[0-9]{1,3}(?:\\.[0-9]{3})+";
const APP_VERSION = "1.0.0";

const GOLD_SOURCES = [
  { brand: "SJC", url: "https://giavang.org/trong-nuoc/sjc/" },
  { brand: "DOJI", url: "https://giavang.org/trong-nuoc/doji/" },
  { brand: "PNJ", url: "https://giavang.org/trong-nuoc/pnj/" },
  { brand: "Bảo Tín Minh Châu", url: "https://giavang.org/trong-nuoc/bao-tin-minh-chau/" },
  { brand: "Bảo Tín Mạnh Hải", url: "https://giavang.org/trong-nuoc/bao-tin-manh-hai/" },
  { brand: "Phú Quý", url: "https://giavang.org/trong-nuoc/phu-quy/" },
  { brand: "Mi Hồng", url: "https://giavang.org/trong-nuoc/mi-hong/" },
  { brand: "Ngọc Thẩm", url: "https://giavang.org/trong-nuoc/ngoc-tham/" }
];

const SILVER_SOURCE = {
  name: "GiaBac.net",
  url: "https://giabac.net/"
};

const ENABLE_METALS_LIVE = process.env.ENABLE_METALS_LIVE === "1";
const METALS_LIVE_SOURCE = { name: "Metals.live", url: "https://api.metals.live/v1/spot" };
const KITCO_SOURCE = { name: "Kitco", url: "https://www.kitco.com/price/precious-metals" };
const GIAVANG_WORLD_SOURCE = { name: "Giavang.org thế giới", url: "https://giavang.org/the-gioi/" };

const REGION_NAMES = [
  "TP. Hồ Chí Minh",
  "Tp. Hồ Chí Minh",
  "TPHCM",
  "Hà Nội",
  "Đà Nẵng",
  "Miền Tây",
  "Tây Nguyên",
  "Đông Nam Bộ",
  "Miền Bắc",
  "Hạ Long",
  "Hải Phòng",
  "Miền Trung",
  "Huế",
  "Quảng Ngãi",
  "Nha Trang",
  "Biên Hòa",
  "Bạc Liêu",
  "Cà Mau",
  "Bắc Ninh",
  "Hải Dương",
  "Bến Tre",
  "Tiền Giang",
  "Mỹ Tho",
  "Vĩnh Long",
  "Long Xuyên",
  "Cần Thơ",
  "Sa Đéc",
  "Trà Vinh",
  "Tân An",
  "Giá vàng nữ trang",
  "Giá vàng nguyên liệu mua ngoài"
].sort((a, b) => b.length - a.length);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

let snapshot = emptySnapshot();
let history = [];
let refreshing = null;
const streamClients = new Set();

function emptySnapshot() {
  return {
    version: APP_VERSION,
    refreshedAt: null,
    nextRefreshAt: null,
    pollIntervalMs: POLL_INTERVAL_MS,
    domesticGold: [],
    silver: [],
    world: [],
    sources: [],
    errors: [],
    stats: {
      domesticGoldRows: 0,
      silverRows: 0,
      worldRows: 0,
      okSources: 0,
      failedSources: 0
    },
    history: []
  };
}

function nowIso() {
  return new Date().toISOString();
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeSpace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return normalizeSpace(value).toLocaleLowerCase("vi-VN");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function htmlToLines(html) {
  const text = decodeHtml(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(td|th)>/gi, "\t")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h[1-6]|li|div|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );

  return text
    .split(/\r?\n/)
    .map((line) => normalizeSpace(line.replace(/\t+/g, "\t")))
    .filter(Boolean);
}

function stripHtml(value) {
  return normalizeSpace(decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")));
}

function parseVietnamDate(raw) {
  const text = normalizeSpace(raw);
  const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, hh, mm, ss = "0", dd, mo, yyyy] = match;
  const date = new Date(
    Number(yyyy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractUpdatedAt(lines) {
  const line = lines.find((item) => /Cập nhật lúc/i.test(item));
  return {
    raw: line || null,
    iso: line ? parseVietnamDate(line) : null
  };
}

function parseThousandVndPerLuong(raw) {
  if (!raw || raw === "-") return null;
  const normalized = String(raw).replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value * 1000 : null;
}

function parseNumber(raw) {
  if (!raw || raw === "-") return null;
  const normalized = String(raw).replace(/,/g, "").trim();
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeRegion(region) {
  const clean = normalizeSpace(region);
  if (/^TPHCM$/i.test(clean)) return "TP. Hồ Chí Minh";
  if (/^Tp\. Hồ Chí Minh$/i.test(clean)) return "TP. Hồ Chí Minh";
  return clean || "Toàn quốc";
}

function splitRegionAndProduct(value, currentRegion) {
  const text = normalizeSpace(value);
  const comparable = normalizeComparable(text);

  for (const region of REGION_NAMES) {
    const regionComparable = normalizeComparable(region);
    if (comparable === regionComparable || comparable.startsWith(`${regionComparable} `)) {
      const product = normalizeSpace(text.slice(region.length));
      return {
        region: normalizeRegion(region),
        product: product || "Vàng"
      };
    }
  }

  return {
    region: currentRegion || "Toàn quốc",
    product: text
  };
}

function isGoldTableHeader(line) {
  const clean = normalizeSpace(line);
  return /Khu vực/i.test(clean) && /Mua vào/i.test(clean) && /Bán ra/i.test(clean);
}

function parseGoldRow(line, currentRegion, source) {
  const clean = normalizeSpace(line.replace(/([0-9])-$/u, "$1 -"));
  const rowMatch = clean.match(new RegExp(`^(.+?)\\s*(${PRICE_PATTERN})\\s+(-|${PRICE_PATTERN})$`, "u"));
  if (!rowMatch) return null;

  const [, label, buyRaw, sellRaw] = rowMatch;
  const { region, product } = splitRegionAndProduct(label, currentRegion);
  if (!product || /Đơn vị|Cập nhật/i.test(product)) return null;

  const buy = parseThousandVndPerLuong(buyRaw);
  const sell = parseThousandVndPerLuong(sellRaw);

  return {
    id: `gold:${source.brand}:${region}:${product}`.toLocaleLowerCase("vi-VN"),
    metal: "gold",
    scope: "domestic",
    brand: source.brand,
    region,
    product,
    buy,
    sell,
    spread: buy != null && sell != null ? sell - buy : null,
    unit: "VND/lượng",
    rawUnit: "x1000đ/lượng",
    source: "Giavang.org",
    sourceName: source.brand,
    sourceUrl: source.url
  };
}

function parseGoldTableRows(html, source, updatedAt) {
  const rows = [];
  let currentRegion = "Toàn quốc";
  const tableMatches = String(html || "").matchAll(/<table\b[\s\S]*?<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const table = tableMatch[0];
    if (!/Mua vào/i.test(table) || !/Bán ra/i.test(table)) continue;

    const rowMatches = table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1];
      const headerCell = rowHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
      if (headerCell) currentRegion = normalizeRegion(stripHtml(headerCell[1]));

      const cells = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) =>
        stripHtml(cell[1])
      );
      if (cells.length < 3) continue;

      let region = currentRegion;
      let product;
      let buyRaw;
      let sellRaw;

      if (cells.length >= 4 && new RegExp(`^${PRICE_PATTERN}$`).test(cells[2])) {
        region = normalizeRegion(cells[0]);
        product = cells[1];
        buyRaw = cells[2];
        sellRaw = cells[3];
      } else {
        product = cells[0];
        buyRaw = cells[1];
        sellRaw = cells[2];
      }

      const buy = parseThousandVndPerLuong(buyRaw);
      const sell = parseThousandVndPerLuong(sellRaw);
      if (buy == null && sell == null) continue;

      const row = {
        id: `gold:${source.brand}:${region}:${product}`.toLocaleLowerCase("vi-VN"),
        metal: "gold",
        scope: "domestic",
        brand: source.brand,
        region,
        product: normalizeSpace(product),
        buy,
        sell,
        spread: buy != null && sell != null ? sell - buy : null,
        unit: "VND/lượng",
        rawUnit: "x1000đ/lượng",
        source: "Giavang.org",
        sourceName: source.brand,
        sourceUrl: source.url,
        updatedAt: updatedAt.iso,
        updatedAtRaw: updatedAt.raw
      };

      rows.push(row);
    }
  }

  return rows;
}

function parseGoldSource(html, source) {
  const lines = htmlToLines(html);
  const updatedAt = extractUpdatedAt(lines);
  const rows = parseGoldTableRows(html, source, updatedAt);
  if (rows.length) return { rows, updatedAt };

  const fallbackRows = [];
  let inTable = false;
  let currentRegion = "Toàn quốc";

  for (const line of lines) {
    if (isGoldTableHeader(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^Cập nhật lúc/i.test(line) || /^https?:\/\//i.test(line)) {
      break;
    }

    const row = parseGoldRow(line, currentRegion, source);
    if (!row) continue;
    row.updatedAt = updatedAt.iso;
    row.updatedAtRaw = updatedAt.raw;
    fallbackRows.push(row);
    currentRegion = row.region;
  }

  return { rows: fallbackRows, updatedAt };
}

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "GoldSilverTrackerVN/1.0 (+local dashboard)",
        "accept": "text/html,application/json;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

async function withSourceStatus(sourceName, url, work) {
  const started = Date.now();
  try {
    const result = await work();
    const rows = Array.isArray(result.rows) ? result.rows : [];
    return {
      rows,
      status: {
        name: sourceName,
        url,
        ok: true,
        rowCount: rows.length,
        updatedAt: result.updatedAt?.iso || null,
        updatedAtRaw: result.updatedAt?.raw || null,
        durationMs: Date.now() - started,
        error: null
      }
    };
  } catch (error) {
    return {
      rows: [],
      status: {
        name: sourceName,
        url,
        ok: false,
        rowCount: 0,
        updatedAt: null,
        updatedAtRaw: null,
        durationMs: Date.now() - started,
        error: error.message || String(error)
      }
    };
  }
}

async function fetchVietnamGold() {
  const settled = await Promise.all(
    GOLD_SOURCES.map((source) =>
      withSourceStatus(`Giavang.org - ${source.brand}`, source.url, async () => {
        const html = await fetchText(source.url);
        return parseGoldSource(html, source);
      })
    )
  );

  const dedupe = new Map();
  for (const result of settled) {
    for (const row of result.rows) {
      dedupe.set(row.id, row);
    }
  }

  return {
    rows: Array.from(dedupe.values()).sort((a, b) => {
      const brand = a.brand.localeCompare(b.brand, "vi");
      if (brand) return brand;
      const region = a.region.localeCompare(b.region, "vi");
      if (region) return region;
      return a.product.localeCompare(b.product, "vi");
    }),
    statuses: settled.map((item) => item.status)
  };
}

function parseSilverRowsFromSection(lines, header, currency) {
  const rows = [];
  const start = lines.findIndex((line) => normalizeComparable(line).includes(normalizeComparable(header)));
  if (start < 0) return rows;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/GIÁ THẾ GIỚI|TỶ GIÁ|TRANG SỨC|###/i.test(line)) break;
    if (/Đơn vị|Mua|Bán/i.test(line)) continue;

    const match = line.match(/^(1\s+(?:Ounce|Gram|Chỉ|Lượng|Kg))\s+([0-9,.]+)\s+([0-9,.]+)$/iu);
    if (!match) continue;
    const [, unitLabel, buyRaw, sellRaw] = match;
    const buy = parseNumber(buyRaw);
    const sell = parseNumber(sellRaw);
    rows.push({
      id: `silver:${currency}:${unitLabel}`.toLocaleLowerCase("vi-VN"),
      metal: "silver",
      scope: currency === "VND" ? "domestic-converted" : "world",
      brand: "M+ Metal",
      region: "Việt Nam",
      product: `Bạc ${unitLabel}`,
      buy,
      sell,
      spread: buy != null && sell != null ? sell - buy : null,
      unit: `${currency}/${unitLabel.replace(/^1\s+/, "")}`,
      currency,
      source: SILVER_SOURCE.name,
      sourceName: SILVER_SOURCE.name,
      sourceUrl: SILVER_SOURCE.url
    });
  }
  return rows;
}

function parseSilverSource(html) {
  const lines = htmlToLines(html);
  const dateLine = lines.find((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line));
  const updatedAt = {
    raw: dateLine || null,
    iso: null
  };

  const vndRows = parseSilverRowsFromSection(lines, "Giá bạc thế giới hôm nay (VNĐ)", "VND");
  const usdRows = parseSilverRowsFromSection(lines, "Giá bạc thế giới hôm nay (USD)", "USD");
  const rows = [...vndRows, ...usdRows].map((row) => ({
    ...row,
    updatedAt: updatedAt.iso,
    updatedAtRaw: updatedAt.raw
  }));

  const usdRateLineIndex = lines.findIndex((line) => /Quy đổi VNĐ/i.test(line));
  if (usdRateLineIndex >= 0) {
    const rateLine = lines[usdRateLineIndex];
    const usdRate = rateLine.match(/Quy đổi VNĐ\s+([0-9,.]+)/i);
    if (usdRate) {
      rows.push({
        id: "fx:usd-vnd",
        metal: "fx",
        scope: "reference",
        brand: "FX",
        region: "Việt Nam",
        product: "USD/VND tham khảo",
        buy: parseNumber(usdRate[1]),
        sell: null,
        spread: null,
        unit: "VND/USD",
        currency: "VND",
        source: SILVER_SOURCE.name,
        sourceName: SILVER_SOURCE.name,
        sourceUrl: SILVER_SOURCE.url,
        updatedAt: updatedAt.iso,
        updatedAtRaw: updatedAt.raw
      });
    }
  }

  return { rows, updatedAt };
}

async function fetchSilver() {
  const result = await withSourceStatus(SILVER_SOURCE.name, SILVER_SOURCE.url, async () => {
    const html = await fetchText(SILVER_SOURCE.url);
    return parseSilverSource(html);
  });

  return {
    rows: result.rows,
    statuses: [result.status]
  };
}

function parseMetalsLiveRows(payload) {
  if (!Array.isArray(payload)) return [];
  const merged = Object.assign({}, ...payload);
  const mappings = [
    ["gold", "Gold", "XAU/USD"],
    ["silver", "Silver", "XAG/USD"],
    ["platinum", "Platinum", "XPT/USD"],
    ["palladium", "Palladium", "XPD/USD"]
  ];

  return mappings
    .filter(([key]) => Number.isFinite(Number(merged[key])))
    .map(([key, label, symbol]) => ({
      id: `world:${key}:metals-live`,
      metal: key,
      scope: "world",
      market: "World spot",
      product: symbol,
      name: label,
      last: Number(merged[key]),
      bid: null,
      ask: null,
      change: null,
      changePct: null,
      unit: "USD/oz",
      source: "Metals.live",
      sourceUrl: METALS_LIVE_SOURCE.url,
      updatedAt: nowIso()
    }));
}

function parseKitcoRows(html) {
  const lines = htmlToLines(html);
  const updatedAt = extractUpdatedAt(lines);
  const rows = [];
  const seen = new Set();
  const aliases = {
    Gold: ["gold", "XAU/USD"],
    Silver: ["silver", "XAG/USD"],
    Platinum: ["platinum", "XPT/USD"],
    Palladium: ["palladium", "XPD/USD"],
    Rhodium: ["rhodium", "XRH/USD"]
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(Gold|Silver|Platinum|Palladium|Rhodium)\s+([0-9,]+(?:\.[0-9]+)?)/);
    if (!match) continue;

    const [, label, priceRaw] = match;
    const [metal, product] = aliases[label];
    if (seen.has(metal)) continue;
    seen.add(metal);

    const changeLine = lines[i + 1] || "";
    const changeMatch = changeLine.match(/(-?[0-9,]+(?:\.[0-9]+)?)\s+\((-?[0-9.]+)%\)/);
    rows.push({
      id: `world:${metal}:kitco`,
      metal,
      scope: "world",
      market: "World spot",
      product,
      name: label,
      last: parseNumber(priceRaw),
      bid: null,
      ask: null,
      change: changeMatch ? parseNumber(changeMatch[1]) : null,
      changePct: changeMatch ? parseNumber(changeMatch[2]) : null,
      unit: "USD/oz",
      source: "Kitco",
      sourceUrl: KITCO_SOURCE.url,
      updatedAt: updatedAt.iso,
      updatedAtRaw: updatedAt.raw
    });
  }

  return { rows, updatedAt };
}

function parseGiavangWorldRows(html) {
  const lines = htmlToLines(html);
  const updatedAt = extractUpdatedAt(lines);
  const priceLine = lines.find((line) => /^[0-9,]+(?:\.[0-9]+)?\s+USD\b/.test(line));
  if (!priceLine) return { rows: [], updatedAt };

  const match = priceLine.match(/^([0-9,]+(?:\.[0-9]+)?)\s+USD\s+(-?[0-9,]+(?:\.[0-9]+)?)\s+USD\((-?[0-9.]+)%\)/);
  const fallback = priceLine.match(/^([0-9,]+(?:\.[0-9]+)?)\s+USD/);
  const convertedLine = lines.find((line) => /1 cây vàng theo giá vàng thế giới/i.test(line));
  const convertedMatch = convertedLine?.match(/([0-9.]+)\s+VNĐ/i);
  const rows = [
    {
      id: "world:gold:giavang",
      metal: "gold",
      scope: "world",
      market: "XAU/USD",
      product: "XAU/USD",
      name: "Gold",
      last: parseNumber(match?.[1] || fallback?.[1]),
      bid: null,
      ask: null,
      change: match ? parseNumber(match[2]) : null,
      changePct: match ? parseNumber(match[3]) : null,
      unit: "USD/oz",
      source: "Giavang.org",
      sourceUrl: GIAVANG_WORLD_SOURCE.url,
      updatedAt: updatedAt.iso,
      updatedAtRaw: updatedAt.raw
    }
  ];

  if (convertedMatch) {
    rows.push({
      id: "world:gold-vnd-luong:giavang",
      metal: "gold",
      scope: "world-converted",
      market: "Quy đổi Việt Nam",
      product: "Vàng thế giới quy đổi",
      name: "Gold converted",
      last: parseNumber(convertedMatch[1].replace(/\./g, "")),
      bid: null,
      ask: null,
      change: null,
      changePct: null,
      unit: "VND/lượng",
      source: "Giavang.org",
      sourceUrl: GIAVANG_WORLD_SOURCE.url,
      updatedAt: updatedAt.iso,
      updatedAtRaw: updatedAt.raw
    });
  }

  return { rows, updatedAt };
}

async function fetchWorldMetals() {
  const optionalSources = [];
  if (ENABLE_METALS_LIVE) {
    optionalSources.push(
      withSourceStatus(METALS_LIVE_SOURCE.name, METALS_LIVE_SOURCE.url, async () => {
        const json = await fetchJson(METALS_LIVE_SOURCE.url);
        return { rows: parseMetalsLiveRows(json), updatedAt: { iso: nowIso(), raw: "live API" } };
      })
    );
  }

  const kitco = await withSourceStatus(KITCO_SOURCE.name, KITCO_SOURCE.url, async () => {
    const html = await fetchText(KITCO_SOURCE.url);
    return parseKitcoRows(html);
  });

  const giavangWorld = await withSourceStatus(GIAVANG_WORLD_SOURCE.name, GIAVANG_WORLD_SOURCE.url, async () => {
    const html = await fetchText(GIAVANG_WORLD_SOURCE.url);
    return parseGiavangWorldRows(html);
  });

  const optionalResults = await Promise.all(optionalSources);
  const rowsByMetal = new Map();
  for (const row of [...optionalResults.flatMap((source) => source.rows), ...kitco.rows, ...giavangWorld.rows]) {
    const key = `${row.metal}:${row.product}:${row.unit}`;
    if (!rowsByMetal.has(key)) rowsByMetal.set(key, row);
  }

  return {
    rows: Array.from(rowsByMetal.values()),
    statuses: [...optionalResults.map((source) => source.status), kitco.status, giavangWorld.status]
  };
}

function makeHistoryPoint(current) {
  const isPrimarySjcRow = (row) =>
    row?.brand === "SJC" &&
    row.sell != null &&
    /Vàng SJC/i.test(row.product || "") &&
    /1L|10L|1KG/i.test(row.product || "");

  const hcmSjc = current.domesticGold.find(
    (row) => isPrimarySjcRow(row) && /hồ chí minh|toàn quốc/i.test(row.region)
  ) || current.domesticGold.find(isPrimarySjcRow)
    || current.domesticGold.find((row) => row.brand === "SJC" && row.sell != null);

  const goldSpot = current.world.find((row) => row.metal === "gold" && row.unit === "USD/oz" && row.last != null);
  const silverLuong = current.silver.find((row) => row.metal === "silver" && row.currency === "VND" && /Lượng/i.test(row.product));

  return {
    t: current.refreshedAt,
    sjcSell: hcmSjc?.sell ?? null,
    goldSpot: goldSpot?.last ?? null,
    silverSellLuong: silverLuong?.sell ?? null
  };
}

async function loadPersistedHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    history = parsed
      .filter((point) => point && point.t)
      .map((point) => {
        const sjcSell = Number(point.sjcSell);
        return {
          t: point.t,
          sjcSell: Number.isFinite(sjcSell) && sjcSell >= 100_000_000 ? sjcSell : null,
          goldSpot: Number.isFinite(Number(point.goldSpot)) ? Number(point.goldSpot) : null,
          silverSellLuong: Number.isFinite(Number(point.silverSellLuong)) ? Number(point.silverSellLuong) : null
        };
      })
      .slice(-HISTORY_LIMIT);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("[history load failed]", error.message || error);
    }
  }
}

async function persistHistory() {
  try {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  } catch (error) {
    console.warn("[history save failed]", error.message || error);
  }
}

async function collectSnapshot() {
  const [gold, silver, world] = await Promise.all([fetchVietnamGold(), fetchSilver(), fetchWorldMetals()]);
  const refreshedAt = nowIso();
  const nextRefreshAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
  const sources = [...gold.statuses, ...silver.statuses, ...world.statuses];
  const errors = sources.filter((source) => !source.ok).map((source) => `${source.name}: ${source.error}`);

  const current = {
    version: APP_VERSION,
    refreshedAt,
    nextRefreshAt,
    pollIntervalMs: POLL_INTERVAL_MS,
    domesticGold: gold.rows,
    silver: silver.rows,
    world: world.rows,
    sources,
    errors,
    stats: {
      domesticGoldRows: gold.rows.length,
      silverRows: silver.rows.length,
      worldRows: world.rows.length,
      okSources: sources.filter((source) => source.ok).length,
      failedSources: sources.filter((source) => !source.ok).length
    },
    history: []
  };

  history.push(makeHistoryPoint(current));
  history = history.slice(-HISTORY_LIMIT);
  await persistHistory();
  current.history = history;
  return current;
}

async function refreshPrices(reason = "timer") {
  if (refreshing) return refreshing;
  refreshing = collectSnapshot()
    .then((current) => {
      snapshot = current;
      broadcastSnapshot(reason);
      return current;
    })
    .catch((error) => {
      const previous = snapshot || emptySnapshot();
      snapshot = {
        ...previous,
        refreshedAt: previous.refreshedAt || nowIso(),
        nextRefreshAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
        errors: [...(previous.errors || []), `Refresh failed: ${error.message || error}`].slice(-10)
      };
      broadcastSnapshot("error");
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value, null, 2));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const source = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const compressed = zlib.deflateRawSync(source);
    const crc = crc32(source);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function normalizeSheetName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function xlsxCell(value, rowIndex, colIndex, styleId = 0) {
  const ref = `${columnName(colIndex)}${rowIndex}`;
  const style = styleId ? ` s="${styleId}"` : "";
  if (value == null || value === "") return `<c r="${ref}"${style}/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${xmlEscape(value)}</t></is></c>`;
}

function buildWorksheetXml(sheet) {
  const rows = sheet.rows || [];
  const maxCols = Math.max(1, ...rows.map((row) => row.length));
  const lastCell = `${columnName(maxCols - 1)}${Math.max(1, rows.length)}`;
  const colXml = Array.from({ length: maxCols }, (_, index) => {
    const width = sheet.widths?.[index] || 16;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const rowsXml = rows
    .map((row, rowIndex) => {
      const excelRow = rowIndex + 1;
      const isHeader = rowIndex === 0;
      const cellXml = row.map((cell, colIndex) => {
        const value = cell && typeof cell === "object" && Object.hasOwn(cell, "value") ? cell.value : cell;
        const styleId = isHeader ? 1 : cell?.styleId || (typeof value === "number" ? 2 : 0);
        return xlsxCell(value, excelRow, colIndex, styleId);
      }).join("");
      return `<row r="${excelRow}">${cellXml}</row>`;
    })
    .join("");

  const autoFilter = rows.length > 1 ? `<autoFilter ref="A1:${lastCell}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${colXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${autoFilter}
</worksheet>`;
}

function buildWorkbookXml(sheets) {
  const sheetXml = sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(normalizeSheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetXml}</sheets>
</workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const worksheetRels = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildContentTypesXml(sheets) {
  const sheetOverrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheetOverrides}
</Types>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F7B73"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2DD"/></left><right style="thin"><color rgb="FFD9E2DD"/></right><top style="thin"><color rgb="FFD9E2DD"/></top><bottom style="thin"><color rgb="FFD9E2DD"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function buildXlsx(current) {
  const sheets = [
    {
      name: "Vàng trong nước",
      widths: [18, 22, 38, 16, 16, 16, 16, 24, 18, 42],
      rows: [
        ["Thương hiệu", "Khu vực", "Loại vàng", "Mua vào", "Bán ra", "Chênh lệch", "Đơn vị", "Cập nhật", "Nguồn", "URL"],
        ...current.domesticGold.map((row) => [
          row.brand,
          row.region,
          row.product,
          row.buy,
          row.sell,
          row.spread,
          row.unit,
          row.updatedAt || row.updatedAtRaw,
          row.source,
          row.sourceUrl
        ])
      ]
    },
    {
      name: "Bạc",
      widths: [18, 18, 26, 16, 16, 16, 16, 12, 24, 42],
      rows: [
        ["Nguồn", "Khu vực", "Sản phẩm", "Mua", "Bán", "Chênh lệch", "Đơn vị", "Tiền tệ", "Cập nhật", "URL"],
        ...current.silver.map((row) => [
          row.source,
          row.region,
          row.product,
          row.buy,
          row.sell,
          row.spread,
          row.unit,
          row.currency,
          row.updatedAt || row.updatedAtRaw,
          row.sourceUrl
        ])
      ]
    },
    {
      name: "Thế giới",
      widths: [16, 16, 20, 16, 16, 14, 14, 18, 24, 42],
      rows: [
        ["Kim loại", "Mã", "Thị trường", "Giá cuối", "Thay đổi", "% thay đổi", "Đơn vị", "Nguồn", "Cập nhật", "URL"],
        ...current.world.map((row) => [
          row.name || row.metal,
          row.product,
          row.market,
          row.last,
          row.change,
          row.changePct,
          row.unit,
          row.source,
          row.updatedAt || row.updatedAtRaw,
          row.sourceUrl
        ])
      ]
    },
    {
      name: "Lịch sử",
      widths: [24, 18, 18, 18],
      rows: [
        ["Thời điểm", "SJC bán ra", "XAU/USD", "Bạc/lượng"],
        ...(current.history || []).map((row) => [row.t, row.sjcSell, row.goldSpot, row.silverSellLuong])
      ]
    },
    {
      name: "Nguồn dữ liệu",
      widths: [28, 12, 12, 28, 14, 34, 48],
      rows: [
        ["Nguồn", "Trạng thái", "Số dòng", "Cập nhật", "Thời gian ms", "Lỗi", "URL"],
        ...current.sources.map((row) => [
          row.name,
          row.ok ? "OK" : "Lỗi",
          row.rowCount,
          row.updatedAt || row.updatedAtRaw,
          row.durationMs,
          row.error,
          row.url
        ])
      ]
    }
  ];

  const files = [
    {
      name: "[Content_Types].xml",
      content: buildContentTypesXml(sheets)
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Precious Metals Prices</dc:title>
  <dc:creator>Gold Silver Tracker VN</dc:creator>
  <cp:lastModifiedBy>Gold Silver Tracker VN</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Gold Silver Tracker VN</Application>
</Properties>`
    },
    {
      name: "xl/workbook.xml",
      content: buildWorkbookXml(sheets)
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: buildWorkbookRelsXml(sheets)
    },
    {
      name: "xl/styles.xml",
      content: buildStylesXml()
    },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: buildWorksheetXml(sheet)
    }))
  ];

  return createZip(files);
}

function broadcastSnapshot(event = "prices") {
  const payload = JSON.stringify({ event, data: snapshot });
  for (const client of streamClients) {
    client.write(`event: prices\ndata: ${payload}\n\n`);
  }
}

async function serveStatic(request, response, requestUrl) {
  const decoded = decodeURIComponent(requestUrl.pathname);
  const relativePath = decoded === "/" ? "index.html" : decoded.slice(1);
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.message || "Server error");
  }
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (requestUrl.pathname === "/api/prices") {
    writeJson(response, 200, snapshot);
    return;
  }

  if (requestUrl.pathname === "/api/refresh" && request.method === "POST") {
    try {
      const current = await refreshPrices("manual");
      writeJson(response, 200, current);
    } catch (error) {
      writeJson(response, 500, { error: error.message || String(error), snapshot });
    }
    return;
  }

  if (requestUrl.pathname === "/api/export.xlsx") {
    const workbook = buildXlsx(snapshot);
    response.writeHead(200, {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=\"precious-metals-prices.xlsx\"",
      "cache-control": "no-store"
    });
    response.end(workbook);
    return;
  }

  if (requestUrl.pathname === "/api/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write(`event: prices\ndata: ${JSON.stringify({ event: "connected", data: snapshot })}\n\n`);
    streamClients.add(response);
    request.on("close", () => streamClients.delete(response));
    return;
  }

  await serveStatic(request, response, requestUrl);
}

async function start() {
  await loadPersistedHistory();
  await refreshPrices("startup").catch((error) => {
    console.error("[startup refresh failed]", error.message || error);
  });

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      writeJson(response, 500, { error: error.message || String(error) });
    });
  });

  const timer = setInterval(() => {
    refreshPrices("timer").catch((error) => {
      console.error("[refresh failed]", error.message || error);
    });
  }, POLL_INTERVAL_MS);
  timer.unref();

  const keepAlive = setInterval(() => {
    for (const client of streamClients) {
      client.write(`: keep-alive ${Date.now()}\n\n`);
    }
  }, 25_000);
  keepAlive.unref();

  server.listen(PORT, HOST, () => {
    console.log(`Gold/Silver Tracker VN running at http://${HOST}:${PORT}`);
    console.log(`Polling every ${Math.round(POLL_INTERVAL_MS / 1000)}s`);
  });
}

async function runOnce() {
  await loadPersistedHistory();
  const current = await refreshPrices("once");
  console.log(
    JSON.stringify(
      {
        refreshedAt: current.refreshedAt,
        stats: current.stats,
        errors: current.errors,
        sampleGold: current.domesticGold.slice(0, 3),
        sampleSilver: current.silver.slice(0, 3),
        sampleWorld: current.world.slice(0, 3)
      },
      null,
      2
    )
  );
}

if (process.argv.includes("--once")) {
  runOnce().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
