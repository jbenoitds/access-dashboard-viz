// Shared helpers for the data pipeline (Node >= 12, standard library only).
//   - a seeded PRNG, so a given --seed always produces the same synthetic data
//   - calendar arithmetic on integer day numbers (no time zones involved)
//   - a small CSV reader / writer compatible with the emr-access-indicators files
//   - geodesic helpers (haversine distance, polygon area and centroid)
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- PRNG ----
// sfc32 seeded through splitmix32: fast, good quality, identical on every
// platform (Math.random() cannot be seeded).
function makeRng(seed) {
  let s = seed >>> 0;
  function splitmix() {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  }
  let a = splitmix(), b = splitmix(), c = splitmix(), d = splitmix();
  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  for (let i = 0; i < 15; i++) next();
  const rng = {
    uniform(lo, hi) { return lo === undefined ? next() : lo + (hi - lo) * next(); },
    integer(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); }, // inclusive
    chance(p) { return next() < p; },
    normal(mean, sd) { // Box-Muller
      const u = 1 - next(), v = next();
      return (mean || 0) + (sd === undefined ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    exponential(mean) { return -mean * Math.log(1 - next()); },
    poisson(lambda) { // Knuth; lambda stays small here
      const l = Math.exp(-lambda);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > l);
      return k - 1;
    },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    weighted(weights, total) { // index drawn proportionally to weights
      let x = next() * (total === undefined ? weights.reduce((s, w) => s + w, 0) : total);
      for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
      return weights.length - 1;
    },
  };
  return rng;
}

// ---------------------------------------------------------------- dates ---
// Day numbers count days since 1970-01-01 (Howard Hinnant's algorithms).
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { year: yoe + era * 400 + (m <= 2 ? 1 : 0), month: m, day: d };
}

const pad2 = (n) => (n < 10 ? '0' : '') + n;

function formatDate(day) {
  const c = civilFromDays(day);
  return c.year + '-' + pad2(c.month) + '-' + pad2(c.day);
}

// Minutes since 1970-01-01 00:00 (naive local time).
function formatTimestamp(minutes) {
  const day = Math.floor(minutes / 1440);
  const m = minutes - day * 1440;
  return formatDate(day) + ' ' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

// Accepts YYYY-MM-DD, YYYY-MM-DD HH:MM[:SS] and YYYY-MM-DDTHH:MM. Returns
// minutes, or null when the text is empty or malformed.
function parseTimestamp(text) {
  const t = (text || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (!m) return null;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return daysFromCivil(+m[1], mo, d) * 1440 + (m[4] ? +m[4] * 60 + +m[5] : 0);
}

function parseDate(text) {
  const t = parseTimestamp(text);
  return t === null ? null : Math.floor(t / 1440);
}

function weekday(day) { // 0 = Monday ... 6 = Sunday
  return ((day % 7) + 7 + 3) % 7;
}

function monthKey(day) {
  const c = civilFromDays(day);
  return c.year + '-' + pad2(c.month);
}

// ---------------------------------------------------------------- CSV -----
function detectDelimiter(headerLine) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of headerLine) if (ch in counts) counts[ch]++;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

// RFC 4180 parser: quoted fields, doubled quotes, CRLF, BOM. Returns
// { header: [...lowercased names], rows: [[...], ...] }.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delim = detectDelimiter(firstLine);
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  return { header, rows: rows.filter((r) => !(r.length === 1 && r[0] === '')) };
}

function readCsv(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

// Returns the index of the first matching column name, or -1.
function column(header, names) {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Buffered line writer, so millions of rows do not build one giant string.
function csvWriter(file, header) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  let buf = [], size = 0, count = 0;
  function flush() {
    if (buf.length) fs.writeSync(fd, buf.join(''));
    buf = []; size = 0;
  }
  function write(values) {
    const line = values.map(csvEscape).join(',') + '\n';
    buf.push(line); size += line.length; count++;
    if (size > 1 << 20) flush();
  }
  write(header);
  count = 0;
  return {
    write,
    close() { flush(); fs.closeSync(fd); return count; },
  };
}

// ---------------------------------------------------------------- geo -----
const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Area (km2) and centroid of a lon/lat ring, using a local equirectangular
// projection: accurate to well under 1% at the scale of a health territory.
function ringAreaCentroid(ring) {
  let lat0 = 0;
  for (const p of ring) lat0 += p[1];
  lat0 /= ring.length;
  const kx = 111.320 * Math.cos(lat0 * Math.PI / 180), ky = 110.574;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * kx, yi = ring[i][1] * ky, xj = ring[j][0] * kx, yj = ring[j][1] * ky;
    const f = xj * yi - xi * yj;
    a += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
  }
  a /= 2;
  return { areaKm2: Math.abs(a), centroid: [cx / (6 * a) / kx, cy / (6 * a) / ky] };
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Outer ring of a GeoJSON Polygon or the largest polygon of a MultiPolygon.
function outerRing(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates[0];
  if (geometry.type === 'MultiPolygon') {
    let best = null, bestArea = -1;
    for (const poly of geometry.coordinates) {
      const a = ringAreaCentroid(poly[0]).areaKm2;
      if (a > bestArea) { bestArea = a; best = poly[0]; }
    }
    return best;
  }
  throw new Error('Unsupported geometry type: ' + geometry.type);
}

function geometryArea(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const poly of polys) {
    total += ringAreaCentroid(poly[0]).areaKm2;
    for (let h = 1; h < poly.length; h++) total -= ringAreaCentroid(poly[h]).areaKm2;
  }
  return total;
}

module.exports = {
  makeRng,
  daysFromCivil, civilFromDays, formatDate, formatTimestamp, parseTimestamp, parseDate, weekday, monthKey,
  parseCsv, readCsv, column, csvEscape, csvWriter,
  haversineKm, ringAreaCentroid, pointInRing, outerRing, geometryArea,
};
