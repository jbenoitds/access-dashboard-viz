#!/usr/bin/env node
// build-data.js - assembles data/dashboard.json, the single file the
// dashboard loads.
//
// Inputs
//   --territory DIR  areas.geojson (one feature per local area, with
//                    area_id, population, deprivation_quintile,
//                    attachment_rate, ...) and clinics.csv (clinic_id, lon, lat,
//                    name_en, name_fr, kind)
//   --raw DIR        the EMR extracts given to emr_access: providers.csv,
//                    patients.csv (with an extra area_id column = area of
//                    residence) and visits.csv
//   --engine DIR     optional: indicators.csv and demand_supply.csv written by
//                    emr_access (github: emr-access-indicators)
//   --out FILE       default data/dashboard.json
//
// What it computes (everything else the dashboard derives in the browser):
//   - an additive count cube  area x clinic x month x measure  (visits,
//     walk-ins, continuity numerator/denominator, no-shows, ...)
//   - wait-time counts  area x clinic x month x days  (booking -> visit, for
//     completed scheduled appointments), so medians and percentiles can be
//     recomputed exactly for any filter
//   - registered patients by area of residence and clinic
//   - straight-line distances (km) from each area centroid to each clinic
// Indicator definitions follow emr-access-indicators / Breton et al. (2023).
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./lib/common');

const ROOT = path.resolve(__dirname, '..');
const opt = {
  territory: path.join(ROOT, 'data/territory'), raw: path.join(ROOT, 'data/raw'),
  engine: path.join(ROOT, 'data/engine'), out: path.join(ROOT, 'data/dashboard.json'),
  from: null, to: null, synthetic: true, generated: C.formatDate(Math.floor(Date.now() / 86400000)),
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], v = process.argv[i + 1];
  if (a === '--territory') { opt.territory = path.resolve(v); i++; }
  else if (a === '--raw') { opt.raw = path.resolve(v); i++; }
  else if (a === '--engine') { opt.engine = v === 'none' ? null : path.resolve(v); i++; }
  else if (a === '--out') { opt.out = path.resolve(v); i++; }
  else if (a === '--from') { opt.from = v; i++; }
  else if (a === '--to') { opt.to = v; i++; }
  else if (a === '--generated') { opt.generated = v; i++; }
  else if (a === '--real-data') { opt.synthetic = false; }
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node pipeline/build-data.js [--territory DIR] [--raw DIR] [--engine DIR|none] [--out FILE]\n' +
      '                                  [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--real-data]');
    process.exit(0);
  } else { console.error('build-data: unknown option ' + a); process.exit(2); }
}

const MAX_WAIT = 120;                  // wait days above this go in one overflow bin
const FIELDS = [
  'visits',              // completed visits, any provider
  'doctor_visits',       // completed visits with a physician or resident
  'walk_ins',            // completed walk-in visits with a physician or resident
  'reg_doctor_visits',   // registered patients: completed physician/resident visits at their own clinic
  'reg_with_r',          //   ... of which with their registered physician (UPC numerator)
  'reg_walk_ins',        //   ... of which walk-ins
  'no_shows',            // scheduled no-shows
  'no_show_den',         // scheduled completed + no-show
  'unregistered_visits', // completed visits by patients without a family physician
  'wait_n',              // completed scheduled appointments with a booking time
  'wait_days',           //   ... sum of their waits in days (exact mean, incl. the overflow bin)
];
const F = {};
FIELDS.forEach((f, i) => { F[f] = i; });

function fail(msg) { console.error('build-data: ' + msg); process.exit(1); }
function need(file) { if (!fs.existsSync(file)) fail('missing ' + file); return file; }

// -------------------------------------------------------------- territory --
const geo = JSON.parse(fs.readFileSync(need(path.join(opt.territory, 'areas.geojson')), 'utf8'));
const areas = geo.features.map((f, i) => {
  const p = f.properties || {};
  const id = String(p.area_id !== undefined ? p.area_id : p.id !== undefined ? p.id : i + 1);
  if (!(p.population >= 0)) fail('area ' + id + ': population is required');
  const ring = C.outerRing(f.geometry);
  return { id, props: p, geometry: f.geometry, km2: C.geometryArea(f.geometry), centroid: C.ringAreaCentroid(ring).centroid };
});
const areaIndex = new Map(areas.map((a, i) => [a.id, i]));
const UNKNOWN_AREA = areas.length; // patients with no (or an unknown) area_id

const clinicCsv = C.readCsv(need(path.join(opt.territory, 'clinics.csv')));
const col = (names) => C.column(clinicCsv.header, names);
const cId = col(['clinic_id', 'id']), cLon = col(['lon', 'longitude', 'x']), cLat = col(['lat', 'latitude', 'y']);
if (cId < 0 || cLon < 0 || cLat < 0) fail('clinics.csv needs clinic_id, lon, lat');
const cEn = col(['name_en', 'name']), cFr = col(['name_fr', 'nom', 'name']), cKind = col(['kind', 'type']);
const clinics = clinicCsv.rows.map((r) => ({
  id: r[cId], name_en: cEn >= 0 ? r[cEn] : r[cId], name_fr: cFr >= 0 ? r[cFr] : r[cId],
  kind: cKind >= 0 ? r[cKind] : '', lon: +r[cLon], lat: +r[cLat],
}));
const clinicIndex = new Map(clinics.map((c, i) => [c.id, i]));
for (const c of clinics) {
  const home = areas.find((a) => C.pointInRing([c.lon, c.lat], C.outerRing(a.geometry)));
  c.area_id = home ? home.id : null;
}
const distKm = areas.map((a) => clinics.map((c) => +C.haversineKm(a.centroid[0], a.centroid[1], c.lon, c.lat).toFixed(2)));

// -------------------------------------------------------------- providers --
const provCsv = C.readCsv(need(path.join(opt.raw, 'providers.csv')));
const pId = C.column(provCsv.header, ['provider_id', 'id_intervenant']);
const pClinic = C.column(provCsv.header, ['clinic_id', 'clinic', 'gmf']);
const pType = C.column(provCsv.header, ['provider_type', 'type', 'discipline']);
const TYPE_ALIASES = {
  physician: 'physician', 'médecin': 'physician', medecin: 'physician', md: 'physician',
  resident: 'resident', 'résident': 'resident', residente: 'resident', 'résidente': 'resident',
  nurse_practitioner: 'nurse_practitioner', ips: 'nurse_practitioner', np: 'nurse_practitioner',
  nurse: 'nurse', 'infirmière': 'nurse', infirmiere: 'nurse', 'infirmier': 'nurse',
  student: 'student', stagiaire: 'student', external: 'external', externe: 'external',
};
const providers = [];
const providerIndex = new Map();
for (const r of provCsv.rows) {
  const ci = clinicIndex.get(r[pClinic]);
  if (ci === undefined) fail('provider ' + r[pId] + ': clinic ' + r[pClinic] + ' is not in clinics.csv');
  const raw = (r[pType] || '').trim().toLowerCase();
  const type = TYPE_ALIASES[raw] || (raw ? 'professional' : 'other');
  providerIndex.set(r[pId], providers.length);
  providers.push({ id: r[pId], clinic: ci, type });
}
const isDoctor = (p) => p.type === 'physician' || p.type === 'resident';

// --------------------------------------------------------------- patients --
const patCsv = C.readCsv(need(path.join(opt.raw, 'patients.csv')));
const tId = C.column(patCsv.header, ['patient_id', 'id_patient']);
const tReg = C.column(patCsv.header, ['registered_provider_id', 'registered_provider', 'medecin_inscripteur']);
const tArea = C.column(patCsv.header, ['area_id', 'area', 'secteur', 'rls', 'clsc']);
if (tArea < 0) console.error('build-data: warning: patients.csv has no area_id column; every patient will be in "unknown area"');
const patients = new Map(); // id -> { area, reg (provider index or -1) }
const registered = areas.map(() => clinics.map(() => 0));
const registeredUnknownArea = clinics.map(() => 0);
let unknownAreaPatients = 0;
for (const r of patCsv.rows) {
  let area = tArea >= 0 ? areaIndex.get(r[tArea]) : undefined;
  if (area === undefined) { area = UNKNOWN_AREA; unknownAreaPatients++; }
  const regId = tReg >= 0 ? (r[tReg] || '').trim() : '';
  const reg = regId && providerIndex.has(regId) ? providerIndex.get(regId) : -1;
  patients.set(r[tId], { area, reg });
  if (reg >= 0) {
    if (area === UNKNOWN_AREA) registeredUnknownArea[providers[reg].clinic]++;
    else registered[area][providers[reg].clinic]++;
  }
}

// ----------------------------------------------------------------- visits --
const visCsv = C.readCsv(need(path.join(opt.raw, 'visits.csv')));
const h = visCsv.header;
const vPat = C.column(h, ['patient_id', 'id_patient']), vProv = C.column(h, ['provider_id', 'id_intervenant']);
const vStart = C.column(h, ['start', 'visit_at', 'appointment_at', 'date_rdv', 'start_time']);
const vBooked = C.column(h, ['booked_at', 'requested_at', 'request_at', 'booking_time', 'date_demande']);
const vStatus = C.column(h, ['status', 'statut', 'visit_status']);
const vMode = C.column(h, ['mode', 'visit_mode', 'visit_type', 'type_visite']);
if (vPat < 0 || vProv < 0 || vStart < 0) fail('visits.csv needs patient_id, provider_id, start');

function normStatus(s) {
  const t = (s || '').trim().toLowerCase();
  if (!t || t === 'completed' || t === 'complété' || t === 'complete' || t === 'present' || t === 'présent') return 'completed';
  if (t === 'no_show' || t === 'noshow' || t === 'absent' || t.indexOf('non présenté') !== -1 || t.indexOf('non presente') !== -1) return 'no_show';
  if (t.indexOf('cancel') !== -1 || t.indexOf('annul') !== -1) return 'cancelled';
  return 'other';
}
function normMode(s) {
  const t = (s || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return t === 'walk_in' || t === 'walkin' || t === 'sans_rdv' || t === 'sans_rendez_vous' ? 'walk_in' : 'scheduled';
}

let windowStart = opt.from ? C.parseDate(opt.from) : null;
let windowEnd = opt.to ? C.parseDate(opt.to) : null;
const parsed = [];
let minDay = Infinity, maxDay = -Infinity, skipped = 0;
for (const r of visCsv.rows) {
  const start = C.parseTimestamp(r[vStart]);
  const prov = providerIndex.get(r[vProv]);
  if (start === null || prov === undefined) { skipped++; continue; }
  const day = Math.floor(start / 1440);
  if (windowStart !== null && day < windowStart) continue;
  if (windowEnd !== null && day > windowEnd) continue;
  minDay = Math.min(minDay, day); maxDay = Math.max(maxDay, day);
  const booked = vBooked >= 0 ? C.parseTimestamp(r[vBooked]) : null;
  parsed.push({ pat: r[vPat], prov, day, booked, status: normStatus(vStatus >= 0 ? r[vStatus] : ''), mode: normMode(vMode >= 0 ? r[vMode] : '') });
}
if (!parsed.length) fail('no usable visits');
if (windowStart === null) windowStart = minDay;
if (windowEnd === null) windowEnd = maxDay;

// Calendar months covering the window.
const months = [];
{
  const a = C.civilFromDays(windowStart), b = C.civilFromDays(windowEnd);
  for (let y = a.year, m = a.month; y < b.year || (y === b.year && m <= b.month); m === 12 ? (y++, m = 1) : m++) {
    months.push(y + '-' + String(m).padStart(2, '0'));
  }
}
const monthIndex = new Map(months.map((m, i) => [m, i]));

const A = areas.length + 1, NC = clinics.length, NM = months.length, NF = FIELDS.length;
const cube = new Array(A * NC * NM * NF).fill(0);
const cell = (a, c, m) => ((a * NC + c) * NM + m) * NF;
const waitCounts = new Map(); // "a,c,m,d" -> n
const unattachedUsers = areas.map(() => clinics.map(() => 0));
const seenUnattached = new Set();

for (const v of parsed) {
  const p = providers[v.prov];
  const ci = p.clinic;
  const mi = monthIndex.get(C.monthKey(v.day));
  const pat = patients.get(v.pat) || { area: UNKNOWN_AREA, reg: -1 };
  const base = cell(pat.area, ci, mi);
  const doctor = isDoctor(p);
  if (v.status === 'completed') {
    cube[base + F.visits]++;
    if (doctor) {
      cube[base + F.doctor_visits]++;
      if (v.mode === 'walk_in') cube[base + F.walk_ins]++;
    }
    if (pat.reg < 0) {
      cube[base + F.unregistered_visits]++;
      const key = v.pat + '|' + ci;
      if (pat.area !== UNKNOWN_AREA && !seenUnattached.has(key)) { seenUnattached.add(key); unattachedUsers[pat.area][ci]++; }
    } else if (doctor && providers[pat.reg].clinic === ci) {
      cube[base + F.reg_doctor_visits]++;
      if (v.prov === pat.reg) cube[base + F.reg_with_r]++;
      if (v.mode === 'walk_in') cube[base + F.reg_walk_ins]++;
    }
  }
  if (v.mode === 'scheduled' && (v.status === 'completed' || v.status === 'no_show')) {
    cube[base + F.no_show_den]++;
    if (v.status === 'no_show') cube[base + F.no_shows]++;
  }
  if (v.mode === 'scheduled' && v.status === 'completed' && v.booked !== null) {
    const days = v.day - Math.floor(v.booked / 1440);
    if (days >= 0) {
      cube[base + F.wait_n]++;
      cube[base + F.wait_days] += days;
      const key = pat.area + ',' + ci + ',' + mi + ',' + Math.min(days, MAX_WAIT + 1);
      waitCounts.set(key, (waitCounts.get(key) || 0) + 1);
    }
  }
}
const waits = { a: [], c: [], m: [], d: [], n: [] };
Array.from(waitCounts.keys()).sort((x, y) => {
  const p = x.split(',').map(Number), q = y.split(',').map(Number);
  return p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || p[3] - q[3];
}).forEach((k) => {
  const p = k.split(',').map(Number);
  waits.a.push(p[0]); waits.c.push(p[1]); waits.m.push(p[2]); waits.d.push(p[3]); waits.n.push(waitCounts.get(k));
});

// ----------------------------------------------------------------- engine --
const KEEP = /^(third_next_available_days|open_slots_48h|relational_continuity|walk_in_use|multidisciplinary_index|no_show_rate|wait_time_(median|mean|p90)_days|coc_bice_boxerman|discipline_mix:.+)$/;
let engine = null;
if (opt.engine && fs.existsSync(path.join(opt.engine, 'indicators.csv'))) {
  const ind = C.readCsv(path.join(opt.engine, 'indicators.csv'));
  const ix = (n) => C.column(ind.header, [n]);
  const I = { indicator: ix('indicator'), level: ix('level'), clinic: ix('clinic_id'), provider: ix('provider_id'),
    ptype: ix('provider_type'), period: ix('period_type'), start: ix('period_start'), num: ix('numerator'),
    den: ix('denominator'), value: ix('value'), n: ix('n'), unit: ix('unit'), flag: ix('flag') };
  const series = new Map();
  const num = (s) => (s === '' || s === undefined ? null : +s);
  for (const r of ind.rows) {
    if (!KEEP.test(r[I.indicator])) continue;
    if (!clinicIndex.has(r[I.clinic])) continue;
    const key = [r[I.indicator], r[I.level], r[I.clinic], r[I.provider], r[I.period]].join('|');
    if (!series.has(key)) {
      series.set(key, { indicator: r[I.indicator], level: r[I.level], clinic: r[I.clinic], provider: r[I.provider] || null,
        provider_type: r[I.ptype] || null, period: r[I.period], unit: r[I.unit], points: [] });
    }
    // [period_start, value, numerator, denominator, n, flag]
    series.get(key).points.push([r[I.start], num(r[I.value]), num(r[I.num]), num(r[I.den]), +r[I.n] || 0, r[I.flag] || '']);
  }
  let demandSupply = [];
  const dsFile = path.join(opt.engine, 'demand_supply.csv');
  if (fs.existsSync(dsFile)) {
    const ds = C.readCsv(dsFile);
    demandSupply = ds.rows.map((r) => {
      const o = {};
      ds.header.forEach((k, i) => { o[k] = /^(level|clinic_id|provider_id|provider_type|reference_date)$/.test(k) ? (r[i] || null) : num(r[i]); });
      return o;
    });
  }
  engine = { source: 'emr_access (emr-access-indicators)', series: Array.from(series.values()), demand_supply: demandSupply };
} else {
  console.error('build-data: no engine output found; the access-indicator panels will be empty');
}

// ------------------------------------------------------------------ write --
const round = (x, d) => +x.toFixed(d);
const bundle = {
  version: 1,
  meta: {
    title: 'Primary Care Accessibility & Health Equity Mapper',
    synthetic: opt.synthetic,
    territory_name: geo.name || 'Territory',
    window: { start: C.formatDate(windowStart), end: C.formatDate(windowEnd) },
    months,
    generated: opt.generated,
    max_wait_days: MAX_WAIT,
    visits_used: parsed.length,
    visits_skipped: skipped,
    unknown_area_patients: unknownAreaPatients,
  },
  areas: {
    type: 'FeatureCollection',
    features: areas.map((a) => ({
      type: 'Feature',
      properties: Object.assign({}, a.props, { area_id: a.id, area_km2: round(a.km2, 2),
        centroid: [round(a.centroid[0], 5), round(a.centroid[1], 5)] }),
      geometry: a.geometry,
    })),
  },
  clinics: clinics.map((c, ci) => {
    const byType = {};
    for (const p of providers) if (p.clinic === ci) byType[p.type] = (byType[p.type] || 0) + 1;
    return Object.assign({}, c, { providers: byType });
  }),
  providers: providers.map((p) => ({ id: p.id, clinic: clinics[p.clinic].id, type: p.type })),
  dist_km: distKm,
  registered,
  registered_unknown_area: registeredUnknownArea,
  unattached_users: unattachedUsers,
  cube: { fields: FIELDS, dims: ['area (last = unknown)', 'clinic', 'month', 'field'], shape: [A, NC, NM, NF], data: cube },
  waits: Object.assign({ max_days: MAX_WAIT, note: 'd = MAX_WAIT + 1 means more than MAX_WAIT days' }, waits),
  engine,
};
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
// Two copies: the .json for other tools, and a .js wrapper that index.html
// loads with a <script> tag, so the dashboard also works when opened straight
// from disk (file://), where browsers block fetch().
const json = JSON.stringify(bundle);
const jsOut = opt.out.replace(/\.json$/i, '') + '.js';
fs.writeFileSync(opt.out, json);
fs.writeFileSync(jsOut, '// Generated by pipeline/build-data.js - do not edit.\nwindow.DASHBOARD_DATA = ' + json + ';\n');
const kb = Math.round(fs.statSync(jsOut).size / 1024);
console.error('build-data: wrote ' + path.relative(process.cwd(), opt.out) + ' and ' + path.basename(jsOut) + ' (' + kb + ' KB): ' + areas.length + ' areas, ' +
  clinics.length + ' clinics, ' + months.length + ' months, ' + parsed.length + ' visits, ' + waits.n.length +
  ' wait cells' + (engine ? ', ' + engine.series.length + ' engine series' : ''));
