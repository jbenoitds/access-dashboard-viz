#!/usr/bin/env node
// synth.js - generates a FICTIONAL health territory and synthetic EMR extracts.
//
// Outputs
//   <territory>/areas.geojson   local areas: population, age mix, deprivation
//                               quintile, attachment rate (all synthetic)
//   <territory>/clinics.csv     six fictional family medicine groups (GMF)
//   <raw>/providers.csv, patients.csv, visits.csv, slots.csv
//                               extracts in the input format of
//                               emr-access-indicators (emr_access), plus an
//                               `area_id` column on patients (the engine
//                               ignores unknown columns)
//
// Nothing here is real data. The territory is drawn procedurally (Voronoi
// cells inside a blob), and the behavioural effects below are modelling
// assumptions chosen to make the dashboard's equity views meaningful to
// demonstrate, NOT findings:
//   - more deprived areas: lower attachment, more walk-in use, slightly lower
//     relational continuity, more no-shows, slightly longer booking delays
//   - longer distance to the clinic: more no-shows
//
// Usage: node pipeline/synth.js [--seed N] [--territory DIR] [--raw DIR]
//                               [--start YYYY-MM-DD] [--months N]
'use strict';

const fs = require('fs');
const path = require('path');
const d3 = require('../js/vendor/d3.v6.3.1.min.js');
const C = require('./lib/common');

// ------------------------------------------------------------- options ----
const ROOT = path.resolve(__dirname, '..');
const opt = { seed: 2021, territory: path.join(ROOT, 'data/territory'), raw: path.join(ROOT, 'data/raw'),
  start: '2021-08-01', months: 12, horizon: 28 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], v = process.argv[i + 1];
  if (a === '--seed') { opt.seed = +v; i++; }
  else if (a === '--territory') { opt.territory = path.resolve(v); i++; }
  else if (a === '--raw') { opt.raw = path.resolve(v); i++; }
  else if (a === '--start') { opt.start = v; i++; }
  else if (a === '--months') { opt.months = +v; i++; }
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node pipeline/synth.js [--seed N] [--territory DIR] [--raw DIR] [--start YYYY-MM-DD] [--months N]');
    process.exit(0);
  } else { console.error('synth: unknown option ' + a); process.exit(2); }
}
const rng = C.makeRng(opt.seed);
const START = C.parseDate(opt.start);
if (START === null) { console.error('synth: bad --start'); process.exit(2); }
const s0 = C.civilFromDays(START);
const endMonths = s0.year * 12 + (s0.month - 1) + opt.months;
const END = C.daysFromCivil(Math.floor(endMonths / 12), (endMonths % 12) + 1, s0.day); // exclusive
const YEARS = (END - START) / 365;

// --------------------------------------------------------- the territory --
// Work in local kilometres (x east, y north) around an arbitrary origin, then
// convert to lon/lat so the files are ordinary WGS84 GeoJSON. The origin is in
// the open North Atlantic on purpose: loaded in a GIS, the territory cannot be
// mistaken for a real place.
const LON0 = -40.05, LAT0 = 45.42;
const KX = 111.320 * Math.cos(LAT0 * Math.PI / 180), KY = 110.574;
const toLonLat = (p) => [+(LON0 + p[0] / KX).toFixed(5), +(LAT0 + p[1] / KY).toFixed(5)];

const CITY = [0, 0], TOWN_E = [18, 6], TOWN_W = [-17, -8], POCKET = [2.6, -1.6];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const phase = [rng.uniform(0, 6.28), rng.uniform(0, 6.28), rng.uniform(0, 6.28)];
function boundaryRadius(theta) {
  return 26 * (1 + 0.18 * Math.sin(3 * theta + phase[0]) + 0.09 * Math.sin(5 * theta + phase[1]) +
    0.05 * Math.cos(2 * theta + phase[2]));
}
const blob = [];
for (let k = 0; k < 160; k++) {
  const t = (k / 160) * 2 * Math.PI;
  const r = boundaryRadius(t);
  blob.push([r * Math.cos(t), r * Math.sin(t)]);
}
const insideBlob = (p) => Math.hypot(p[0], p[1]) < boundaryRadius(Math.atan2(p[1], p[0]));

// Residential density (people / km2): a city, two small towns, rural fill.
function density(p) {
  return 1500 * Math.exp(-dist(p, CITY) / 2.6) + 380 * Math.exp(-dist(p, TOWN_E) / 1.8) +
    320 * Math.exp(-dist(p, TOWN_W) / 1.8) + 16;
}

// Area seeds by dart throwing, closer together where density is high.
function spacing(p) { // ~equal population per urban area, capped in rural zones
  return Math.min(8, Math.max(1.5, Math.sqrt(3800 / density(p))));
}
const candidates = [];
while (candidates.length < 30000) {
  const p = [rng.uniform(-36, 36), rng.uniform(-36, 36)];
  if (insideBlob(p)) candidates.push({ p, s: spacing(p), r: rng.uniform() });
}
// Densest candidates first, so urban areas get their small cells.
candidates.sort((a, b) => (a.s - b.s) + 0.4 * (a.r - b.r));
const seeds = [], seedSpacing = [];
for (const c of candidates) {
  let ok = true;
  for (let k = 0; k < seeds.length; k++) {
    if (dist(c.p, seeds[k]) < 0.5 * (c.s + seedSpacing[k])) { ok = false; break; }
  }
  if (ok) { seeds.push(c.p); seedSpacing.push(c.s); }
}
// Number areas from the city centre outwards.
seeds.sort((a, b) => dist(a, CITY) - dist(b, CITY));

// Sutherland-Hodgman: clip the (possibly concave) blob by a convex Voronoi cell.
function clipByConvex(subject, clip) {
  let orient = 0;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    orient += a[0] * b[1] - b[0] * a[1];
  }
  const sign = orient > 0 ? 1 : -1;
  const inside = (p, a, b) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
  const cross = (p, q, a, b) => {
    const a1 = q[1] - p[1], b1 = p[0] - q[0], c1 = a1 * p[0] + b1 * p[1];
    const a2 = b[1] - a[1], b2 = a[0] - b[0], c2 = a2 * a[0] + b2 * a[1];
    const det = a1 * b2 - a2 * b1;
    return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
  };
  let out = subject.slice();
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p, a, b), qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cross(p, q, a, b));
    }
  }
  return out;
}

const voronoi = d3.Delaunay.from(seeds).voronoi([-40, -40, 40, 40]);
const smooth = (p) => 0.55 * Math.sin(p[0] / 6.5 + phase[0]) + 0.45 * Math.cos(p[1] / 5.5 + phase[1]) +
  0.35 * Math.sin((p[0] + p[1]) / 9 + phase[2]);

const areas = seeds.map((seed, i) => {
  const cell = voronoi.cellPolygon(i).slice(0, -1);
  const ring = clipByConvex(blob, cell);
  const lonlat = ring.map(toLonLat);
  lonlat.push(lonlat[0]);
  const geo = C.ringAreaCentroid(lonlat);
  // Population = density integrated over the cell (regular grid of samples).
  let sum = 0, inside = 0;
  const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
  for (let gx = 0; gx < 24; gx++) {
    for (let gy = 0; gy < 24; gy++) {
      const q = [x0 + (x1 - x0) * (gx + 0.5) / 24, y0 + (y1 - y0) * (gy + 0.5) / 24];
      if (C.pointInRing(q, ring)) { sum += density(q); inside++; }
    }
  }
  const meanDensity = inside ? sum / inside : density(seed);
  const pop = Math.max(150, Math.round(meanDensity * geo.areaKm2 * rng.uniform(0.9, 1.1) / 10) * 10);
  const dens = pop / geo.areaKm2;
  const urban = dens >= 400 ? 'urban' : dens >= 60 ? 'suburban' : 'rural';
  const depScore = 0.6 * smooth(seed) + 1.3 * Math.exp(-(dist(seed, POCKET) ** 2) / (2 * 1.7 * 1.7)) +
    (urban === 'rural' ? 0.55 : 0) + 0.4 * Math.exp(-(dist(seed, TOWN_E) ** 2) / 10) + rng.normal(0, 0.15);
  return { idx: i, id: 'S' + String(i + 1).padStart(2, '0'), seed, ring: lonlat, areaKm2: geo.areaKm2,
    centroid: geo.centroid, pop, density: dens, urban, depScore,
    share0to5: +(0.06 + rng.normal(0, 0.006)).toFixed(3),
    share70plus: +((urban === 'rural' ? 0.19 : urban === 'suburban' ? 0.15 : 0.13) + rng.normal(0, 0.012)).toFixed(3) };
});

// Population-weighted deprivation quintiles (1 = least deprived), as for the
// Pampalon index.
{
  const order = areas.slice().sort((a, b) => a.depScore - b.depScore);
  const total = d3.sum(areas, (a) => a.pop);
  let cum = 0;
  for (const a of order) {
    const mid = (cum + a.pop / 2) / total;
    a.quintile = Math.min(5, 1 + Math.floor(mid * 5));
    cum += a.pop;
  }
}
for (const a of areas) {
  const attach = 0.87 - 0.035 * (a.quintile - 1) - (a.urban === 'rural' ? 0.04 : 0) + rng.normal(0, 0.018);
  a.attach = +Math.min(0.95, Math.max(0.55, attach)).toFixed(3);
}

// --------------------------------------------------------------- clinics --
const CLINICS = [
  { id: 'GMF-A', en: 'GMF A · Downtown', fr: 'GMF A · Centre-ville', at: [0.5, 0.6], kind: 'GMF-U', md: 12, res: 6, ips: 2, nurse: 4, prof: 4, student: 1, lambda: 4.5, slow: 1.0 },
  { id: 'GMF-B', en: 'GMF B · East Central', fr: 'GMF B · Centre-Est', at: [2.9, -1.4], kind: 'GMF', md: 9, res: 0, ips: 2, nurse: 3, prof: 3, student: 0, lambda: 4.0, slow: 1.25 },
  { id: 'GMF-C', en: 'GMF C · North', fr: 'GMF C · Nord', at: [0.8, 6.8], kind: 'GMF', md: 8, res: 0, ips: 1, nurse: 2, prof: 2, student: 0, lambda: 5.0, slow: 0.9 },
  { id: 'GMF-D', en: 'GMF D · Southwest', fr: 'GMF D · Sud-Ouest', at: [-5.2, -4.1], kind: 'GMF', md: 7, res: 0, ips: 1, nurse: 2, prof: 1, student: 0, lambda: 5.0, slow: 1.0 },
  { id: 'GMF-E', en: 'GMF E · East Village', fr: 'GMF E · Village-Est', at: TOWN_E, kind: 'GMF', md: 5, res: 0, ips: 1, nurse: 2, prof: 1, student: 0, lambda: 10, slow: 1.35 },
  { id: 'GMF-F', en: 'GMF F · West Village', fr: 'GMF F · Village-Ouest', at: TOWN_W, kind: 'GMF', md: 4, res: 0, ips: 1, nurse: 1, prof: 1, student: 0, lambda: 10, slow: 1.15 },
];
for (const c of CLINICS) {
  c.lonlat = toLonLat(c.at);
  const home = areas.find((a) => C.pointInRing(c.lonlat, a.ring));
  c.area = home ? home.id : areas[0].id;
  c.distKm = areas.map((a) => C.haversineKm(a.centroid[0], a.centroid[1], c.lonlat[0], c.lonlat[1]));
}

// -------------------------------------------------------------- providers --
const providers = []; // {id, clinic, type, continuity, backlog, noShow, works[5]}
const physiciansOf = CLINICS.map(() => []), doctorsOf = CLINICS.map(() => []), othersOf = CLINICS.map(() => []);
CLINICS.forEach((c, ci) => {
  const mix = [['physician', c.md], ['resident', c.res], ['nurse_practitioner', c.ips], ['nurse', c.nurse],
    ['professional', c.prof], ['student', c.student]];
  let k = 0;
  for (const [type, count] of mix) {
    for (let n = 0; n < count; n++) {
      const advanced = rng.chance(0.35);
      const p = {
        id: c.id.slice(-1) + '-' + String(++k).padStart(3, '0'), clinic: ci, type,
        continuity: rng.uniform(0.55, 0.9),
        backlog: (type === 'physician' ? (advanced ? rng.uniform(1, 4) : rng.uniform(4, 19)) : rng.uniform(1.5, 9)) * c.slow,
        noShow: rng.uniform(0.02, 0.06),
        works: [false, false, false, false, false],
      };
      let days = type === 'resident' ? 4 : rng.integer(3, 5);
      while (days > 0) { const wd = rng.integer(0, 4); if (!p.works[wd]) { p.works[wd] = true; days--; } }
      const idx = providers.push(p) - 1;
      if (type === 'physician') physiciansOf[ci].push(idx);
      if (type === 'physician' || type === 'resident') doctorsOf[ci].push(idx);
      else if (type !== 'student') othersOf[ci].push(idx);
    }
  }
});

// ------------------------------------------------- registration (rosters) --
// Rosters per clinic, distributed over areas with a gravity model balanced by
// iterative proportional fitting so that (a) each clinic's roster size and (b)
// each area's attached population are both respected.
const rosterTarget = CLINICS.map((c, ci) => d3.sum(physiciansOf[ci], () => rng.uniform(1000, 1400)));
const attached = areas.map((a) => a.pop * a.attach);
const share = d3.sum(rosterTarget) / d3.sum(attached);
const areaTarget = attached.map((x) => x * share);
const M = areas.map((a, i) => CLINICS.map((c) => Math.exp(-c.distKm[i] / c.lambda)));
for (let it = 0; it < 80; it++) {
  M.forEach((row, i) => { const s = d3.sum(row); row.forEach((v, j) => { row[j] = s ? v * areaTarget[i] / s : 0; }); });
  CLINICS.forEach((c, j) => { const s = d3.sum(M, (r) => r[j]); M.forEach((r) => { r[j] = s ? r[j] * rosterTarget[j] / s : 0; }); });
}

const patients = []; // {id, area, clinic, reg, birth, vulnerable, pregnant}
let patientSeq = 0;
function newPatient(area, clinic, reg) {
  const a = areas[area];
  const u = rng.uniform();
  const age = u < a.share0to5 ? rng.integer(0, 5) : u < a.share0to5 + a.share70plus ? rng.integer(70, 98) : rng.integer(6, 69);
  const p = {
    id: 'P' + String(++patientSeq).padStart(6, '0'), area, clinic, reg, age,
    birth: START - age * 365 - rng.integer(0, 364),
    vulnerable: rng.chance((age >= 70 ? 0.30 : 0.10) * (1 + 0.15 * (a.quintile - 1))),
    pregnant: age >= 18 && age <= 42 && rng.chance(0.02),
  };
  patients.push(p);
  return p;
}
const mdWeight = providers.map(() => rng.uniform(0.6, 1.4));
areas.forEach((a, i) => {
  CLINICS.forEach((c, j) => {
    const x = M[i][j];
    const n = Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0);
    const mds = physiciansOf[j], w = mds.map((k) => mdWeight[k]);
    for (let k = 0; k < n; k++) newPatient(i, j, mds[rng.weighted(w)]);
  });
});
// Unattached residents who use the clinics' walk-in services during the year.
areas.forEach((a, i) => {
  const users = Math.round(a.pop * (1 - a.attach) * 0.22);
  const w = CLINICS.map((c) => Math.exp(-c.distKm[i] / 5));
  for (let k = 0; k < users; k++) newPatient(i, rng.weighted(w), -1);
});

// ----------------------------------------------------------------- visits --
fs.mkdirSync(opt.raw, { recursive: true });
const visitsOut = C.csvWriter(path.join(opt.raw, 'visits.csv'),
  ['visit_id', 'patient_id', 'provider_id', 'booked_at', 'start', 'status', 'mode']);
let visitSeq = 0;
const days = END - START;
function randomWeekday() {
  for (;;) { const d = START + rng.integer(0, days - 1); if (C.weekday(d) < 5) return d; }
}
function writeVisit(pat, provIdx, walkIn) {
  const p = providers[provIdx];
  const a = areas[pat.area];
  const q = a.quintile;
  const day = randomWeekday();
  const start = day * 1440 + 8 * 60 + 20 * rng.integer(0, 23);
  let booked, status = 'completed';
  if (walkIn) {
    booked = start - rng.integer(10, 180);
  } else {
    const lead = Math.round(rng.exponential(p.backlog * (1 + 0.05 * (q - 1))));
    booked = (day - lead) * 1440 + 8 * 60 + rng.integer(0, 8 * 60);
    if (booked > start) booked = start - 30;
    const ns = p.noShow * (1 + 0.18 * (q - 1)) * (1 + CLINICS[p.clinic].distKm[pat.area] / 40);
    const u = rng.uniform();
    if (u < ns) status = 'no_show';
    else if (u < ns + 0.04) status = 'cancelled_patient';
    else if (u < ns + 0.05) status = 'cancelled_clinic';
  }
  visitsOut.write(['V' + (++visitSeq), pat.id, p.id, C.formatTimestamp(booked), C.formatTimestamp(start), status,
    walkIn ? 'walk_in' : 'scheduled']);
}
for (const pat of patients) {
  const q = areas[pat.area].quintile;
  const docs = doctorsOf[pat.clinic], oth = othersOf[pat.clinic];
  if (pat.reg < 0) { // unattached: walk-in only
    const k = 1 + rng.poisson(0.8);
    for (let v = 0; v < k; v++) writeVisit(pat, rng.pick(docs), true);
    continue;
  }
  let rate = (pat.vulnerable || pat.age >= 70 || pat.age <= 5) ? 2.8 : 1.4;
  if (pat.pregnant) rate = 6.0;
  const k = rng.poisson(rate * (1 + 0.05 * (q - 1)) * YEARS);
  const R = providers[pat.reg];
  for (let v = 0; v < k; v++) {
    if (rng.chance(0.04)) { // walk-in at another clinic
      const other = rng.integer(0, CLINICS.length - 2);
      const ci = other >= pat.clinic ? other + 1 : other;
      writeVisit(pat, rng.pick(doctorsOf[ci]), true);
    } else if (rng.chance(R.continuity * (1 - 0.035 * (q - 1)))) {
      writeVisit(pat, pat.reg, rng.chance(0.03));
    } else if (oth.length && rng.chance(0.30)) {
      writeVisit(pat, rng.pick(oth), false);
    } else {
      writeVisit(pat, rng.pick(docs), rng.chance(0.5 + 0.05 * (q - 1)));
    }
  }
}
const nVisits = visitsOut.close();

// ------------------------------------------------------------------ slots --
// Weekly schedule snapshots (Tuesday 07:00).
const slotsOut = C.csvWriter(path.join(opt.raw, 'slots.csv'), ['snapshot_at', 'provider_id', 'start', 'status', 'category']);
let tuesday = START;
while (C.weekday(tuesday) !== 1) tuesday++;
for (; tuesday < END; tuesday += 7) {
  const snap = C.formatTimestamp(tuesday * 1440 + 7 * 60);
  for (const p of providers) {
    if (p.type !== 'physician' && p.type !== 'resident' && p.type !== 'nurse_practitioner') continue;
    for (let off = 0; off < opt.horizon; off++) {
      const day = tuesday + off, wd = C.weekday(day);
      if (wd >= 5 || !p.works[wd]) continue;
      // Booked up to about `backlog` days ahead, mostly open beyond it;
      // advanced-access providers keep same/next-day capacity.
      let pOpen = Math.max(0.002, 0.9 / (1 + Math.exp(-(off - p.backlog) / 1.5)));
      if (off <= 1 && p.backlog < 4) pOpen = Math.max(pOpen, 0.35);
      for (let s = 0; s < 24; s++) {
        const u = rng.uniform();
        const category = u < 0.05 ? 'pediatrics' : u < 0.08 ? 'obstetrics' : 'general';
        const status = rng.chance(0.04) ? 'blocked' : rng.chance(pOpen) ? 'open' : 'booked';
        slotsOut.write([snap, p.id, C.formatTimestamp(day * 1440 + 8 * 60 + 20 * s), status, category]);
      }
    }
  }
}
const nSlots = slotsOut.close();

// ------------------------------------------------------ remaining files ---
{
  const w = C.csvWriter(path.join(opt.raw, 'providers.csv'), ['provider_id', 'clinic_id', 'provider_type']);
  for (const p of providers) w.write([p.id, CLINICS[p.clinic].id, p.type]);
  w.close();
}
{
  const w = C.csvWriter(path.join(opt.raw, 'patients.csv'),
    ['patient_id', 'birth_date', 'registered_provider_id', 'vulnerable', 'pregnant', 'area_id']);
  for (const p of patients) {
    w.write([p.id, C.formatDate(p.birth), p.reg >= 0 ? providers[p.reg].id : '', p.vulnerable ? 1 : 0,
      p.pregnant ? 1 : 0, areas[p.area].id]);
  }
  w.close();
}
fs.mkdirSync(opt.territory, { recursive: true });
{
  const w = C.csvWriter(path.join(opt.territory, 'clinics.csv'),
    ['clinic_id', 'name_en', 'name_fr', 'kind', 'lon', 'lat', 'area_id']);
  for (const c of CLINICS) w.write([c.id, c.en, c.fr, c.kind, c.lonlat[0], c.lonlat[1], c.area]);
  w.close();
}
{
  const fc = {
    type: 'FeatureCollection',
    name: 'Synthetic territory (fictional)',
    features: areas.map((a) => ({
      type: 'Feature',
      properties: {
        area_id: a.id, name_en: 'Area ' + a.id.slice(1), name_fr: 'Secteur ' + a.id.slice(1),
        population: a.pop, urban_class: a.urban, deprivation_quintile: a.quintile,
        attachment_rate: a.attach, share_0_5: a.share0to5, share_70_plus: a.share70plus,
      },
      geometry: { type: 'Polygon', coordinates: [a.ring] },
    })),
  };
  fs.writeFileSync(path.join(opt.territory, 'areas.geojson'),
    '{"type":"FeatureCollection","name":' + JSON.stringify(fc.name) + ',"features":[\n' +
    fc.features.map((f) => JSON.stringify(f)).join(',\n') + '\n]}\n');
}

console.error('synth: ' + areas.length + ' areas (population ' + d3.sum(areas, (a) => a.pop).toLocaleString('en') +
  '), ' + CLINICS.length + ' clinics, ' + providers.length + ' providers, ' + patients.length + ' patients, ' +
  nVisits + ' visits, ' + nSlots + ' slot rows (' + C.formatDate(START) + ' to ' + C.formatDate(END - 1) + ')');
