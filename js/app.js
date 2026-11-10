// app.js - state, filters and the wiring between data and charts.
(function () {
  'use strict';
  const d3 = window.d3, M = window.Metrics, C = window.Charts, I = window.I18n;
  const t = (k) => I.t(k);
  const MIN_N = 20;         // smallest denominator shown for an area
  const SHOW_DAYS = 60;     // wait-time chart: days shown before the "60+" bar
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const QCOLORS = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)'];
  const SEQ = ['var(--seq1)', 'var(--seq2)', 'var(--seq3)', 'var(--seq4)', 'var(--seq5)'];

  let B = null;      // the data bundle
  let D = null;      // derived constants
  const state = { lang: 'en', clinic: 'all', m0: 0, m1: 0, metric: 'access', radius: 15, area: null, hover: null,
    waitCompare: 'none', trend: 'third_next_available_days', sortKey: 'area', sortDir: 1 };

  // ------------------------------------------------------------- loading
  function load() {
    if (window.DASHBOARD_DATA) return Promise.resolve(window.DASHBOARD_DATA);
    return fetch('data/dashboard.json').then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function prepare() {
    const features = B.areas.features;
    const clinicColor = {};
    B.clinics.forEach((c, i) => { clinicColor[c.id] = SERIES[i % SERIES.length]; });
    const engineIndex = new Map();
    if (B.engine) {
      B.engine.series.forEach((s) => engineIndex.set([s.indicator, s.level, s.clinic, s.provider || '', s.period].join('|'), s));
    }
    // weekly snapshot dates (from any clinic-level TNAA series)
    const weekSet = new Set();
    if (B.engine) B.engine.series.forEach((s) => { if (s.period === 'week' && s.level === 'clinic') s.points.forEach((p) => weekSet.add(p[0])); });
    D = {
      features,
      pop: features.map((f) => f.properties.population),
      quintile: features.map((f) => +f.properties.deprivation_quintile || NaN),
      attach: features.map((f) => f.properties.attachment_rate === undefined ? NaN : +f.properties.attachment_rate),
      physicians: B.clinics.map((c) => c.providers.physician || 0),
      F: M.fieldIndex(B),
      clinicColor,
      engineIndex,
      weeks: Array.from(weekSet).sort(),
      A: features.length,
    };
  }

  const series = (indicator, level, clinic, period, provider) =>
    D.engineIndex.get([indicator, level, clinic, provider || '', period].join('|')) || null;

  // ------------------------------------------------------------- filters
  function selClinics() { return state.clinic === 'all' ? B.clinics.map((c, i) => i) : [state.clinic]; }
  function filter() { return { clinics: state.clinic === 'all' ? null : [state.clinic], m0: state.m0, m1: state.m1 }; }
  function allClinicsFilter() { return { clinics: null, m0: state.m0, m1: state.m1 }; }
  const monthOf = (iso) => B.meta.months.indexOf(iso.slice(0, 7));
  const inPeriod = (iso) => { const m = monthOf(iso); return m >= state.m0 && m <= state.m1; };

  // ------------------------------------------------------------- metrics
  function computeAreas() {
    const F = D.F, f = filter();
    const cube = M.sumCube(B, f, (a) => (a < D.A ? a : null));
    const waits = M.sumWaits(B, f, (a) => (a < D.A ? a : null));
    const sel = selClinics();
    const ex = M.e2sfca(D.pop, D.physicians, B.dist_km, state.radius);
    const rows = D.features.map((feat, i) => {
      const x = cube.get(i) || new Array(B.cube.fields.length).fill(0);
      const w = waits.get(i);
      let access = 0, dist = Infinity, reach = 0;
      sel.forEach((j) => {
        access += ex.ratio[j] * M.gaussianWeight(B.dist_km[i][j], state.radius);
        dist = Math.min(dist, B.dist_km[i][j]);
        reach += B.registered[i][j];
      });
      const p = feat.properties;
      return {
        i, id: p.area_id, name: I.lang() === 'fr' ? (p.name_fr || p.name_en || p.area_id) : (p.name_en || p.area_id),
        urban: p.urban_class, pop: D.pop[i], km2: p.area_km2, quintile: D.quintile[i], attach: D.attach[i],
        access: access * 10000, distance: dist, reach: D.pop[i] ? reach / D.pop[i] * 1000 : NaN,
        wait: w ? M.countsQuantile(w, 0.5) : NaN, waitN: x[F.wait_n],
        walkin: M.ratio(x[F.walk_ins], x[F.doctor_visits]), walkinDen: x[F.doctor_visits],
        noshow: M.ratio(x[F.no_shows], x[F.no_show_den]), noshowDen: x[F.no_show_den],
        continuity: M.ratio(x[F.reg_with_r], x[F.reg_doctor_visits]), contDen: x[F.reg_doctor_visits],
        registeredBy: B.registered[i], unattachedBy: B.unattached_users[i],
      };
    });
    return { rows, ratio: ex.ratio };
  }

  // Territory-wide values for the same filter (all areas pooled).
  function territoryValues(rows) {
    const F = D.F, f = filter();
    const cube = M.sumCube(B, f, (a) => (a < D.A ? 'all' : null)).get('all') || new Array(B.cube.fields.length).fill(0);
    const w = M.sumWaits(B, f, (a) => (a < D.A ? 'all' : null)).get('all');
    const pops = rows.map((r) => r.pop);
    return {
      pop: d3.sum(pops), attach: M.weightedMean(rows.map((r) => r.attach), pops),
      access: M.weightedMean(rows.map((r) => r.access), pops), distance: M.weightedMean(rows.map((r) => r.distance), pops),
      reach: d3.sum(rows, (r) => d3.sum(selClinics(), (j) => r.registeredBy[j])) / d3.sum(pops) * 1000,
      wait: w ? M.countsQuantile(w, 0.5) : NaN, walkin: M.ratio(cube[F.walk_ins], cube[F.doctor_visits]),
      noshow: M.ratio(cube[F.no_shows], cube[F.no_show_den]), continuity: M.ratio(cube[F.reg_with_r], cube[F.reg_doctor_visits]),
      quintile: NaN,
    };
  }

  const fmtDays = (v) => isNaN(v) ? '–' : I.num(v, v < 10 && v % 1 ? 1 : 0) + ' ' + t('days');
  const METRICS = [
    { key: 'access', label: 'm_access', unit: 'm_access_unit', fmt: (v) => I.num(v, 1), short: (v) => I.num(v, v % 1 ? 1 : 0), better: 'high' },
    { key: 'attach', label: 'm_attach', unit: 'm_attach_unit', fmt: (v) => I.pct(v, 0), better: 'high' },
    { key: 'quintile', label: 'm_quintile', unit: 'm_quintile_unit', fmt: (v) => isNaN(v) ? '–' : 'Q' + v, ordinal: true },
    { key: 'distance', label: 'm_distance', unit: 'm_distance_unit', fmt: (v) => I.num(v, 1) + ' km', short: (v) => I.num(v, v % 1 ? 1 : 0), better: 'low' },
    { key: 'reach', label: 'm_reach', unit: 'm_reach_unit', fmt: (v) => I.num(v, 0), better: 'high' },
    { key: 'wait', label: 'm_wait', unit: 'm_wait_unit', fmt: fmtDays, short: (v) => I.num(v, v % 1 ? 1 : 0), den: 'waitN', better: 'low' },
    { key: 'walkin', label: 'm_walkin', unit: 'm_walkin_unit', fmt: (v) => I.pct(v, 0), den: 'walkinDen', better: 'low', pct: true },
    { key: 'noshow', label: 'm_noshow', unit: 'm_noshow_unit', fmt: (v) => I.pct(v, 1), short: (v) => I.pct(v, Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 ? 1 : 0), den: 'noshowDen', better: 'low', pct: true },
    { key: 'continuity', label: 'm_continuity', unit: 'm_continuity_unit', fmt: (v) => I.pct(v, 0), den: 'contDen', better: 'high', pct: true },
  ];
  const metric = (k) => METRICS.filter((m) => m.key === k)[0];
  const suppressed = (m, r) => !!m.den && !(r[m.den] >= MIN_N);

  // Engine indicators pooled over the selected clinics and months.
  function pooled(indicator, clinicIdx) {
    const ids = (clinicIdx || selClinics()).map((j) => B.clinics[j].id);
    const list = ids.map((id) => series(indicator, 'clinic', id, 'month'));
    return M.pooledProportion(list, B.meta.months, state.m0, state.m1);
  }
  function pooledByMonth(indicator, clinicIdx) {
    const ids = (clinicIdx || selClinics()).map((j) => B.clinics[j].id);
    const months = d3.range(state.m0, state.m1 + 1);
    return months.map((m) => M.pooledProportion(ids.map((id) => series(indicator, 'clinic', id, 'month')), B.meta.months, m, m).value);
  }
  // Weekly indicators: TNAA = provider-weighted mean of clinic values; open
  // slots = pooled proportion.
  function weekly(indicator, clinicIdx) {
    const ids = (clinicIdx || selClinics()).map((j) => B.clinics[j].id);
    const weeks = D.weeks.filter(inPeriod);
    const values = weeks.map((wk) => {
      let s = 0, n = 0, num = 0, den = 0;
      ids.forEach((id) => {
        const se = series(indicator, 'clinic', id, 'week');
        if (!se) return;
        const p = se.points.filter((q) => q[0] === wk)[0];
        if (!p || p[1] === null) return;
        s += p[1] * p[4]; n += p[4];
        if (p[2] !== null && p[3] !== null) { num += p[2]; den += p[3]; }
      });
      return indicator === 'open_slots_48h' ? M.ratio(num, den) : (n ? s / n : NaN);
    });
    let value;
    if (indicator === 'open_slots_48h') {
      let num = 0, den = 0;
      ids.forEach((id) => {
        const se = series(indicator, 'clinic', id, 'week');
        if (se) se.points.forEach((p) => { if (inPeriod(p[0]) && p[2] !== null) { num += p[2]; den += p[3]; } });
      });
      value = M.ratio(num, den);
    } else {
      const ok = values.filter((v) => !isNaN(v));
      value = ok.length ? d3.mean(ok) : NaN;
    }
    return { weeks, values, value };
  }
  function waitMedian(clinicIdx) {
    const f = { clinics: clinicIdx || (state.clinic === 'all' ? null : [state.clinic]), m0: state.m0, m1: state.m1 };
    const all = M.sumWaits(B, f, () => 'x').get('x');
    const byMonth = M.sumWaits(B, f, (a, c, m) => m);
    const months = d3.range(state.m0, state.m1 + 1);
    return { value: all ? M.countsQuantile(all, 0.5) : NaN, n: all ? M.countsTotal(all) : 0,
      values: months.map((m) => byMonth.has(m) ? M.countsQuantile(byMonth.get(m), 0.5) : NaN) };
  }

  // ----------------------------------------------------------------- KPIs
  function renderKpis() {
    const el = document.getElementById('kpis');
    const single = state.clinic !== 'all';
    const allIdx = B.clinics.map((c, i) => i);
    const sel = selClinics();
    const months = d3.range(state.m0, state.m1 + 1).map((m) => B.meta.months[m]);
    const tiles = [];
    const regCount = (idx) => d3.sum(idx, (j) => d3.sum(B.registered, (r) => r[j]) + (B.registered_unknown_area[j] || 0));
    const reg = regCount(sel), mds = d3.sum(sel, (j) => D.physicians[j]);
    tiles.push({ label: t('registered'), value: I.num(reg), sub: t('registered_sub'),
      cmp: t('physicians') + ' ' + I.num(mds) + ' · ' + t('patients_per_md') + ' ' + I.num(mds ? reg / mds : NaN) });
    if (B.engine) {
      const tn = weekly('third_next_available_days', sel), tnAll = weekly('third_next_available_days', allIdx);
      const weekTip = (w, fmt) => (i) => '<div class="tt-title">' + C.esc(I.date(w.weeks[i])) + '</div>' + C.ttRow(t('tnaa_short'), fmt(w.values[i]));
      tiles.push({ label: t('tnaa'), value: I.num(tn.value, 1), unit: t('days'), sub: t('tnaa_sub'),
        cmp: single ? t('vs_territory') + ' ' + I.num(tnAll.value, 1) + ' ' + t('days') : '', spark: tn.values, tip: weekTip(tn, (v) => I.num(v, 1) + ' ' + t('days')) });
      const o = weekly('open_slots_48h', sel), oAll = weekly('open_slots_48h', allIdx);
      tiles.push({ label: t('open48'), value: I.pct(o.value, 1), sub: t('open48_sub'),
        cmp: single ? t('vs_territory') + ' ' + I.pct(oAll.value, 1) : '', spark: o.values,
        tip: (i) => '<div class="tt-title">' + C.esc(I.date(o.weeks[i])) + '</div>' + C.ttRow(t('open48'), I.pct(o.values[i], 1)) });
    }
    const wm = waitMedian(), wmAll = waitMedian(allIdx);
    tiles.push({ label: t('wait_median'), value: I.num(wm.value, 0), unit: t('days'), sub: t('wait_median_sub'),
      cmp: single ? t('vs_territory') + ' ' + I.num(wmAll.value, 0) + ' ' + t('days') : I.num(wm.n) + ' ' + t('appointments'),
      spark: wm.values, tip: (i) => '<div class="tt-title">' + C.esc(I.month(months[i], true)) + '</div>' + C.ttRow(t('wait_median'), fmtDays(wm.values[i])) });
    if (B.engine) {
      [['relational_continuity', 'continuity'], ['walk_in_use', 'walkin'], ['multidisciplinary_index', 'multi'], ['no_show_rate', 'noshow']].forEach((pair) => {
        const v = pooled(pair[0]), all = pooled(pair[0], allIdx), vals = pooledByMonth(pair[0]);
        const digits = pair[1] === 'noshow' ? 1 : 0;
        tiles.push({ label: t(pair[1]), value: pair[1] === 'multi' ? I.num(v.value, 2) : I.pct(v.value, digits), sub: t(pair[1] + '_sub'),
          cmp: single ? t('vs_territory') + ' ' + (pair[1] === 'multi' ? I.num(all.value, 2) : I.pct(all.value, digits)) : '',
          spark: vals, tip: (i) => '<div class="tt-title">' + C.esc(I.month(months[i], true)) + '</div>' +
            C.ttRow(t(pair[1]), pair[1] === 'multi' ? I.num(vals[i], 2) : I.pct(vals[i], digits)) });
      });
    }
    el.innerHTML = tiles.map((k, i) => '<div class="card kpi"><div class="label">' + C.esc(k.label) + '</div>' +
      '<div class="value">' + C.esc(k.value) + (k.unit ? '<small>' + C.esc(k.unit) + '</small>' : '') + '</div>' +
      '<div class="sub">' + C.esc(k.sub) + '</div>' + (k.spark ? '<div class="spark" data-i="' + i + '"></div>' : '') +
      '<div class="cmp">' + C.esc(k.cmp || '') + '</div></div>').join('') +
      (B.engine ? '' : '<p class="note">' + C.esc(t('no_engine')) + '</p>');
    tiles.forEach((k, i) => {
      if (!k.spark) return;
      const s = el.querySelector('.spark[data-i="' + i + '"]');
      C.sparkline(s, k.spark, { label: k.label, color: 'var(--s1)', tooltip: k.tip });
    });
    const a = B.meta.months[state.m0], b = B.meta.months[state.m1];
    document.getElementById('kpi-period').textContent = (state.clinic === 'all' ? t('all_clinics') : clinicName(B.clinics[state.clinic])) +
      ' · ' + I.month(a) + ' – ' + I.month(b);
  }

  function clinicName(c) { return I.lang() === 'fr' ? c.name_fr : c.name_en; }

  // ------------------------------------------------------------------ map
  let areaData = null, terr = null;
  function colorScale(m, rows) {
    if (m.ordinal) return (v) => QCOLORS[Math.max(0, Math.min(4, v - 1))];
    const vals = rows.filter((r) => !suppressed(m, r) && !isNaN(r[m.key]) && isFinite(r[m.key])).map((r) => r[m.key]);
    // Five equal-interval classes on a rounded domain: breaks stay readable
    // and comparable when the filter changes.
    const ext = d3.extent(vals);
    let lo = ext[0] >= 0 && ext[0] < (ext[1] - ext[0]) / 2 ? 0 : ext[0];
    const raw = Math.max((ext[1] - lo) / 5, 1e-9);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = [1, 2, 2.5, 5, 10].map((k) => k * mag).filter((k) => k >= raw)[0];
    lo = Math.floor(lo / step + 1e-9) * step;
    while (lo + 5 * step < ext[1] - 1e-9) step = [1, 2, 2.5, 5, 10].map((k) => k * mag).filter((k) => k > step)[0] || step * 2;
    // 3 to 5 classes, drawn from the full light-to-dark ramp
    const n = Math.max(3, Math.min(5, Math.ceil((ext[1] - lo) / step - 1e-9)));
    const ramp = { 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] }[n].map((k) => SEQ[k]);
    const q = d3.scaleQuantize().domain([lo, lo + n * step]).range(ramp);
    q.vals = vals;
    return q;
  }

  function renderMap() {
    const m = metric(state.metric);
    const rows = areaData.rows;
    const color = colorScale(m, rows);
    document.getElementById('map-title').textContent = t(m.label);
    document.getElementById('map-unit').textContent = t(m.unit) + (m.key === 'access' && state.clinic !== 'all' ? ' · ' + clinicName(B.clinics[state.clinic]) : '');
    document.getElementById('catchment-ctl').style.display = m.key === 'access' ? '' : 'none';
    const byId = new Map(rows.map((r) => [r.id, r]));
    const el = document.getElementById('map');
    window.MapView.render(el, {
      features: D.features, clinics: B.clinics, label: t('map_heading') + ': ' + t(m.label),
      value: (f) => byId.get(f.properties.area_id)[m.key],
      color: (v) => color(v),
      suppressed: (f) => suppressed(m, byId.get(f.properties.area_id)),
      selectedId: state.area,
      clinicActive: (c) => state.clinic === 'all' || B.clinics[state.clinic].id === c.id,
      ariaValue: (f) => { const r = byId.get(f.properties.area_id); return r.name + ': ' + (suppressed(m, r) ? t('insufficient') : m.fmt(r[m.key])); },
      onHover: (f, event) => {
        const r = byId.get(f.properties.area_id);
        state.hover = r.id;
        C.Tooltip.show('<div class="tt-title">' + C.esc(r.name) + '</div>' +
          C.ttRow(t(m.label), suppressed(m, r) ? t('insufficient') : m.fmt(r[m.key])) +
          C.ttRow(t('population'), I.num(r.pop)) + C.ttRow(t('quintile'), 'Q' + r.quintile, QCOLORS[r.quintile - 1]), event);
        if (!state.area) renderProfile();
      },
      onLeave: () => { C.Tooltip.hide(); state.hover = null; if (!state.area) renderProfile(); },
      onFocus: (f) => { state.hover = f.properties.area_id; if (!state.area) renderProfile(); },
      onSelect: (f) => { state.area = state.area === f.properties.area_id ? null : f.properties.area_id; writeHash(); renderMap(); renderProfile(); renderAreaTable(); },
      onClinicHover: (c, event) => {
        const j = B.clinics.indexOf(c);
        C.Tooltip.show('<div class="tt-title">' + C.esc(clinicName(c)) + '</div>' + C.ttRow(t('kind'), c.kind) +
          C.ttRow(t('physicians'), I.num(D.physicians[j])) +
          C.ttRow(t('registered'), I.num(d3.sum(B.registered, (r) => r[j]) + (B.registered_unknown_area[j] || 0))), event);
      },
    });
    // legend
    const lg = document.getElementById('map-legend');
    let html = '';
    if (m.ordinal) {
      html = '<span class="item">' + C.esc(t('quintile')) + '</span><span class="swatches">' +
        QCOLORS.map((c, i) => '<span class="item"><i class="sw" style="background:' + c + ';width:14px"></i>Q' + (i + 1) + '</span>').join('') + '</span>';
    } else if (color.vals && color.vals.length) {
      // Labels sit on the class breaks.
      const dom = color.domain(), cuts = [dom[0]].concat(color.thresholds()).concat([dom[1]]);
      const ramp = color.range(), k = ramp.length, sw = 40, lw = sw * k;
      const lf = m.short || m.fmt;
      let svgL = '<svg width="' + (lw + 24) + '" height="30" aria-hidden="true">';
      ramp.forEach((c, i) => { svgL += '<rect x="' + (12 + i * sw) + '" y="2" width="' + (sw - 2) + '" height="10" rx="2" style="fill:' + c + '"></rect>'; });
      cuts.forEach((v, i) => {
        svgL += '<text x="' + (12 + i * sw - (i > 0 ? 1 : 0)) + '" y="26" text-anchor="middle"' +
          ' style="font-size:10.5px;fill:var(--muted);font-variant-numeric:tabular-nums">' + C.esc(lf(v)) + '</text>';
      });
      html = '<span class="item">' + svgL + '</svg></span>';
    }
    if (m.den) html += '<span class="item"><i class="hatch"></i>' + C.esc(t('insufficient')) + ' (&lt; ' + MIN_N + ')</span>';
    html += '<span class="item"><i class="ring"></i>' + C.esc(t('clinic_marker')) + '</span>';
    lg.innerHTML = html;
  }

  // -------------------------------------------------------------- profile
  function renderProfile() {
    const el = document.getElementById('profile');
    const id = state.area || state.hover;
    const r = id ? areaData.rows.filter((x) => x.id === id)[0] : null;
    if (!r) {
      el.innerHTML = '<div class="card-head"><div><h3>' + C.esc(t('area_profile')) + '</h3></div></div><p class="empty">' + C.esc(t('area_hint')) + '</p>' +
        '<h5>' + C.esc(t('territory_values')) + '</h5><ul class="stat-list">' + ['access', 'attach', 'distance', 'reach', 'wait', 'walkin', 'noshow', 'continuity'].map((k) => {
          const m = metric(k);
          return '<li><span>' + C.esc(t(m.label)) + '</span><span class="v">' + C.esc(m.fmt(terr[k])) + '</span><span></span></li>';
        }).join('') + '</ul>';
      return;
    }
    const keys = ['access', 'attach', 'distance', 'reach', 'wait', 'walkin', 'noshow', 'continuity'];
    const maxReg = d3.max(r.registeredBy) || 1;
    const regRows = B.clinics.map((c, j) => ({ c, j, n: r.registeredBy[j] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    el.innerHTML = '<div class="card-head"><div><h3>' + C.esc(t('area_profile')) + '</h3></div>' +
      (state.area ? '<button type="button" class="link-btn" id="clear-area">' + C.esc(t('clear_selection')) + '</button>' : '') + '</div>' +
      '<h4>' + C.esc(r.name) + '</h4>' +
      '<div class="meta">' + C.esc(t(r.urban) || r.urban) + ' · ' + C.esc(t('population')) + ' ' + I.num(r.pop) + ' · ' +
      I.num(r.pop / r.km2, 0) + ' ' + C.esc(t('per_km2')) + ' &nbsp; <span class="chip"><i style="background:' + QCOLORS[r.quintile - 1] + '"></i>' +
      C.esc(t('quintile')) + ' ' + r.quintile + '</span></div>' +
      '<ul class="stat-list">' + keys.map((k) => {
        const m = metric(k);
        const v = suppressed(m, r) ? t('insufficient') : m.fmt(r[k]);
        return '<li><span>' + C.esc(t(m.label)) + '</span><span class="v">' + C.esc(v) + '</span><span class="r">' + C.esc(t('territory')) + ' ' + C.esc(m.fmt(terr[k])) + '</span></li>';
      }).join('') + '</ul>' +
      '<h5>' + C.esc(t('where_registered')) + '</h5><div class="bars-mini">' +
      regRows.map((x) => '<div class="row"><span>' + C.esc(x.c.id) + '</span><div class="track"><div class="fill" style="width:' +
        (x.n / maxReg * 100).toFixed(1) + '%"></div></div><span class="n">' + I.num(x.n) + '</span></div>').join('') + '</div>' +
      '<p class="note">' + C.esc(t('unattached_users')) + ': ' + I.num(d3.sum(r.unattachedBy)) + '</p>';
    const btn = document.getElementById('clear-area');
    if (btn) btn.addEventListener('click', () => { state.area = null; writeHash(); renderMap(); renderProfile(); renderAreaTable(); });
  }

  // --------------------------------------------------------------- equity
  function renderEquity() {
    const el = document.getElementById('equity');
    const F = D.F, f = filter();
    const rows = areaData.rows;
    const cubeQ = M.sumCube(B, f, (a) => (a < D.A ? D.quintile[a] : null));
    const waitQ = M.sumWaits(B, f, (a) => (a < D.A ? D.quintile[a] : null));
    const q = [1, 2, 3, 4, 5];
    const popW = (key) => q.map((k) => {
      const rs = rows.filter((r) => r.quintile === k);
      return M.weightedMean(rs.map((r) => r[key]), rs.map((r) => r.pop));
    });
    const pooledQ = (num, den) => q.map((k) => { const x = cubeQ.get(k); return x ? M.ratio(x[F[num]], x[F[den]]) : NaN; });
    const panels = [
      { m: metric('attach'), v: popW('attach') },
      { m: metric('access'), v: popW('access') },
      { m: metric('distance'), v: popW('distance') },
      { m: metric('wait'), v: q.map((k) => waitQ.has(k) ? M.countsQuantile(waitQ.get(k), 0.5) : NaN) },
      { m: metric('walkin'), v: pooledQ('walk_ins', 'doctor_visits') },
      { m: metric('noshow'), v: pooledQ('no_shows', 'no_show_den') },
      { m: metric('continuity'), v: pooledQ('reg_with_r', 'reg_doctor_visits') },
      { m: metric('reach'), v: q.map((k) => { const rs = rows.filter((r) => r.quintile === k); return d3.sum(rs, (r) => r.reach * r.pop / 1000) / d3.sum(rs, (r) => r.pop) * 1000; }) },
    ];
    el.innerHTML = panels.map((p, i) => '<div class="card"><h3>' + C.esc(t(p.m.label)) + '</h3><div class="unit">' + C.esc(t(p.m.unit)) +
      '</div><div class="qb" data-i="' + i + '"></div><div class="gap" data-g="' + i + '"></div></div>').join('');
    panels.forEach((p, i) => {
      C.quintileBars(el.querySelector('.qb[data-i="' + i + '"]'), p.v, { colors: QCOLORS, format: p.m.fmt, title: t(p.m.label), label: t(p.m.label), height: 110 });
      const g = el.querySelector('.gap[data-g="' + i + '"]');
      const diff = p.v[4] - p.v[0];
      if (isNaN(diff)) { g.textContent = ''; return; }
      const tiny = (p.m.pct || p.m.key === 'attach') ? 0.0005 : 0.05;
      if (Math.abs(diff) < tiny) { g.innerHTML = C.esc(t('gap')) + ' <b>0</b> · ' + C.esc(t('gap_none')); return; }
      const worse = p.m.better === 'high' ? diff < 0 : diff > 0;
      const unit = (p.m.pct || p.m.key === 'attach') ? ' ' + (I.lang() === 'fr' ? 'pts' : 'pp') : '';
      const mag = (p.m.pct || p.m.key === 'attach') ? I.num(diff * 100, 1) : I.num(diff, 1);
      g.innerHTML = C.esc(t('gap')) + ' <b class="' + (worse ? 'worse' : 'better') + '">' + (diff > 0 ? '+' : '') + C.esc(mag) + C.esc(unit) +
        '</b> · ' + C.esc(t(worse ? 'gap_worse' : 'gap_better'));
    });
  }

  // ----------------------------------------------------------------- waits
  function renderWaits() {
    const el = document.getElementById('wait-chart'), lg = document.getElementById('wait-legend');
    const days = d3.range(0, SHOW_DAYS + 1);
    if (state.waitCompare === 'none') {
      const counts = M.sumWaits(B, filter(), () => 'x').get('x') || new Array(B.waits.max_days + 2).fill(0);
      const med = M.countsQuantile(counts, 0.5), p90 = M.countsQuantile(counts, 0.9);
      C.histogram(el, counts, {
        showDays: SHOW_DAYS, label: t('wait_heading'), pct: I.pct, xTitle: t('days'), median: med, p90: p90,
        medianLabel: t('median') + ' ' + I.num(med, 0), p90Label: t('p90') + ' ' + I.num(p90, 0),
        tooltip: (b, total) => '<div class="tt-title">' + C.esc(b.k === SHOW_DAYS ? t('over') + ' ' + (SHOW_DAYS - 1) + ' ' + t('days') : b.label + ' ' + (b.k === 1 ? t('day') : t('days'))) + '</div>' +
          C.ttRow(t('appointments'), I.num(b.n)) + C.ttRow(t('share_appointments'), I.pct(total ? b.n / total : NaN, 1)),
      });
      C.legend(lg, [{ type: 'dot', color: 'var(--s1)', label: t('share_appointments') }, { type: 'tick', label: t('median') + ' / ' + t('p90') }]);
      return;
    }
    let groups;
    if (state.waitCompare === 'clinics') {
      const by = M.sumWaits(B, allClinicsFilter(), (a, c) => c);
      groups = B.clinics.map((c, j) => ({ key: c.id, label: c.id, color: D.clinicColor[c.id], counts: by.get(j),
        muted: state.clinic !== 'all' && state.clinic !== j, emph: state.clinic === j }));
      if (state.clinic !== 'all') groups.forEach((g) => { if (g.muted) g.color = 'var(--gray-mark)'; });
    } else {
      const by = M.sumWaits(B, filter(), (a) => (a < D.A ? D.quintile[a] : null));
      groups = [1, 2, 3, 4, 5].map((k) => ({ key: 'Q' + k, label: 'Q' + k, color: QCOLORS[k - 1], counts: by.get(k) }));
    }
    const ser = groups.filter((g) => g.counts).map((g) => {
      const e = M.countsEcdf(g.counts);
      return { key: g.key, label: g.label, color: g.color, muted: g.muted, emph: g.emph, values: days.map((d) => e[d]) };
    });
    C.lines(el, {
      x: days, series: ser, label: t('wait_heading'), yDomain: [0, 1], yFormat: (v) => I.pct(v, 0), xTitle: t('days'),
      xFormatTip: (d) => t('seen_within') + ' ' + d + ' ' + (d === 1 ? t('day') : t('days')), yFormatTip: (v) => I.pct(v, 1), curve: 'step',
    });
    if (state.waitCompare === 'clinics' && state.clinic !== 'all') {
      C.legend(lg, [{ type: 'line', color: D.clinicColor[B.clinics[state.clinic].id], label: B.clinics[state.clinic].id },
        { type: 'line', color: 'var(--gray-mark)', label: t('other_clinics') }]);
    } else {
      C.legend(lg, ser.map((s) => ({ type: 'line', color: s.color, label: s.label })));
    }
  }

  // ---------------------------------------------------------------- trends
  const TRENDS = [
    { key: 'third_next_available_days', label: 'tnaa', weekly: true, fmt: (v) => I.num(v, 1), tip: (v) => I.num(v, 1) + ' ' + t('days') },
    { key: 'open_slots_48h', label: 'open48', weekly: true, fmt: (v) => I.pct(v, 0), tip: (v) => I.pct(v, 1) },
    { key: 'wait_time_median_days', label: 'wait_median', fmt: (v) => I.num(v, 0), tip: (v) => I.num(v, 0) + ' ' + t('days'), value: true },
    { key: 'relational_continuity', label: 'continuity', fmt: (v) => I.pct(v, 0), tip: (v) => I.pct(v, 1) },
    { key: 'walk_in_use', label: 'walkin', fmt: (v) => I.pct(v, 0), tip: (v) => I.pct(v, 1) },
    { key: 'multidisciplinary_index', label: 'multi', fmt: (v) => I.num(v, 2), tip: (v) => I.num(v, 3) },
    { key: 'no_show_rate', label: 'noshow', fmt: (v) => I.pct(v, 0), tip: (v) => I.pct(v, 1) },
  ];
  function renderTrends() {
    const el = document.getElementById('trend-chart'), lg = document.getElementById('trend-legend');
    const tr = TRENDS.filter((x) => x.key === state.trend)[0];
    const parse = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) || 1));
    let xs, ser;
    if (!B.engine) { el.innerHTML = '<p class="empty">' + C.esc(t('no_engine')) + '</p>'; lg.innerHTML = ''; return; }
    if (tr.weekly) {
      const weeks = D.weeks.filter(inPeriod);
      xs = weeks.map(parse);
      ser = B.clinics.map((c, j) => {
        const se = series(tr.key, 'clinic', c.id, 'week');
        const map = new Map(se ? se.points.map((p) => [p[0], p[1] === null ? NaN : p[1]]) : []);
        return { j, c, values: weeks.map((w) => map.has(w) ? map.get(w) : NaN) };
      });
    } else {
      const months = d3.range(state.m0, state.m1 + 1).map((m) => B.meta.months[m]);
      xs = months.map((m) => parse(m + '-01'));
      ser = B.clinics.map((c, j) => {
        const se = series(tr.key, 'clinic', c.id, 'month');
        const map = new Map(se ? se.points.map((p) => [p[0].slice(0, 7), p[1] === null ? NaN : p[1]]) : []);
        return { j, c, values: months.map((m) => map.has(m) ? map.get(m) : NaN) };
      });
    }
    const single = state.clinic !== 'all';
    const lines = ser.map((s) => ({ key: s.c.id, label: s.c.id, values: s.values,
      color: !single || s.j === state.clinic ? D.clinicColor[s.c.id] : 'var(--gray-mark)', muted: single && s.j !== state.clinic, emph: single && s.j === state.clinic }));
    document.getElementById('trend-sub').textContent = t(tr.label + '_sub');
    C.lines(el, {
      x: xs, series: lines, label: t(tr.label), yFormat: tr.fmt, yFormatTip: tr.tip, zero: true,
      xFormat: (d) => new Intl.DateTimeFormat(I.lang() === 'fr' ? 'fr-CA' : 'en-CA', { month: 'short', timeZone: 'UTC' }).format(d),
      xFormatTip: (d) => tr.weekly ? I.date(d.toISOString().slice(0, 10)) : I.month(d.toISOString().slice(0, 7), true),
      curve: tr.weekly ? 'monotone' : 'monotone',
    });
    if (single) {
      const c = B.clinics[state.clinic];
      C.legend(lg, [{ type: 'line', color: D.clinicColor[c.id], label: clinicName(c) }, { type: 'line', color: 'var(--gray-mark)', label: t('other_clinics') }]);
    } else {
      C.legend(lg, B.clinics.map((c) => ({ type: 'line', color: D.clinicColor[c.id], label: c.id })));
    }
  }

  // ------------------------------------------------------------- resources
  function renderResources() {
    const ds = B.engine ? B.engine.demand_supply : [];
    const keys = [{ key: 'own', label: t('supply_own'), color: 'var(--s1)' }, { key: 'other', label: t('supply_other'), color: 'var(--s2)' },
      { key: 'unreg', label: t('supply_unreg'), color: 'var(--s3)' }];
    let rows;
    const single = state.clinic !== 'all';
    if (single) {
      const cid = B.clinics[state.clinic].id;
      rows = ds.filter((r) => r.level === 'provider' && r.clinic_id === cid && r.provider_type === 'physician');
      document.getElementById('ds-title').textContent = t('demand_supply') + ' · ' + cid;
    } else {
      rows = ds.filter((r) => r.level === 'clinic');
      document.getElementById('ds-title').textContent = t('demand_supply_clinics');
    }
    rows = rows.slice().sort((a, b) => b.demand_visits - a.demand_visits).map((r) => ({
      key: r.provider_id || r.clinic_id, label: r.provider_id || r.clinic_id, marker: r.demand_visits, raw: r,
      values: [r.visits_own_registered, r.visits_other_clinic_registered, r.visits_unregistered],
    }));
    const el = document.getElementById('ds-chart');
    if (!rows.length) { el.innerHTML = '<p class="empty">' + C.esc(t('no_engine')) + '</p>'; }
    else {
      C.hstack(el, rows, keys, {
        labelWidth: single ? 64 : 70, rowHeight: single ? 14 : 20, rowGap: single ? 6 : 10, xFormat: (v) => I.num(v),
        label: document.getElementById('ds-title').textContent,
        tooltip: (r, segs, total) => '<div class="tt-title">' + C.esc(r.label) + '</div>' +
          C.ttRow(t('demand'), I.num(r.marker) + ' ' + t('visits')) +
          segs.map((s) => C.ttRow(keys[s.ki].label, I.num(s.raw) + ' (' + I.pct(total ? s.raw / total : NaN, 0) + ')', keys[s.ki].color)).join('') +
          C.ttRow(t('registered'), I.num(r.raw.patients_total)),
      });
    }
    C.legend(document.getElementById('ds-legend'), keys.map((k) => ({ type: 'dot', color: k.color, label: k.label })).concat([{ type: 'tick', label: t('demand') }]));
    const ref = ds.length ? ds[0].reference_date : null;
    document.getElementById('ref-date').textContent = ref ? (I.lang() === 'fr' ? 'Date de référence : ' : 'Reference date: ') + I.date(ref) : '';

    // discipline mix
    const types = ['physician', 'resident', 'nurse_practitioner', 'nurse', 'professional'];
    const tk = types.map((ty, i) => ({ key: ty, label: t('t_' + ty), color: SERIES[i] }));
    const mixRows = B.clinics.map((c, j) => ({
      key: c.id, label: c.id, emph: !single || j === state.clinic,
      values: types.map((ty) => pooled('discipline_mix:' + ty, [j]).num),
    }));
    C.hstack(document.getElementById('mix-chart'), mixRows, tk, {
      percent: true, labelWidth: 56, rowHeight: 16, rowGap: 8, xFormat: (v) => I.pct(v, 0), label: t('mix_heading'),
      tooltip: (r, segs, total) => '<div class="tt-title">' + C.esc(r.label) + '</div>' +
        segs.filter((s) => s.raw > 0).map((s) => C.ttRow(tk[s.ki].label, I.pct(total ? s.raw / total : NaN, 1), tk[s.ki].color)).join(''),
    });
    C.legend(document.getElementById('mix-legend'), tk.map((k) => ({ type: 'dot', color: k.color, label: k.label })));

    // capacity table
    const ratio = areaData.ratio;
    const head = [t('clinic'), t('kind'), t('physicians'), t('registered'), t('patients_per_md'), t('catchment_ratio') + ' · ' + state.radius + ' km'];
    const body = B.clinics.map((c, j) => {
      const reg = d3.sum(B.registered, (r) => r[j]) + (B.registered_unknown_area[j] || 0);
      return '<tr' + (single && j === state.clinic ? ' class="sel"' : '') + '><td>' + C.esc(clinicName(c)) + '</td><td>' + C.esc(c.kind) + '</td><td>' +
        I.num(D.physicians[j]) + '</td><td>' + I.num(reg) + '</td><td>' + I.num(D.physicians[j] ? reg / D.physicians[j] : NaN) +
        '</td><td>' + I.num(ratio[j] * 10000, 1) + '</td></tr>';
    }).join('');
    document.getElementById('capacity-table').innerHTML = '<thead><tr>' + head.map((h) => '<th scope="col">' + C.esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' + body + '</tbody>';
  }

  // ------------------------------------------------------------ area table
  const TABLE_COLS = [
    { key: 'name', label: 'area', fmt: (v) => v, sortKey: 'i' },
    { key: 'urban', label: 'urban_class', fmt: (v) => t(v) || v },
    { key: 'quintile', label: 'quintile', fmt: (v) => 'Q' + v },
    { key: 'pop', label: 'population', fmt: (v) => I.num(v) },
    { key: 'access', m: 'access' }, { key: 'attach', m: 'attach' }, { key: 'distance', m: 'distance' }, { key: 'reach', m: 'reach' },
    { key: 'wait', m: 'wait' }, { key: 'walkin', m: 'walkin' }, { key: 'noshow', m: 'noshow' }, { key: 'continuity', m: 'continuity' },
  ];
  function renderAreaTable() {
    const tbl = document.getElementById('area-table');
    const rows = areaData.rows.slice();
    const sk = state.sortKey === 'area' ? 'i' : state.sortKey;
    rows.sort((a, b) => {
      const x = typeof a[sk] === 'string' ? a[sk].localeCompare(b[sk]) : (isNaN(a[sk]) ? 1e12 : a[sk]) - (isNaN(b[sk]) ? 1e12 : b[sk]);
      return x * state.sortDir;
    });
    const head = TABLE_COLS.map((c) => {
      const label = c.m ? t(metric(c.m).label) : t(c.label);
      const key = c.key === 'name' ? 'area' : c.key;
      const sort = state.sortKey === key ? (state.sortDir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + sort + '"><button type="button" data-k="' + key + '">' + C.esc(label) + '</button></th>';
    }).join('');
    const body = rows.map((r) => '<tr data-id="' + C.esc(r.id) + '"' + (r.id === state.area ? ' class="sel"' : '') + '>' + TABLE_COLS.map((c) => {
      if (c.m) { const m = metric(c.m); return '<td>' + C.esc(suppressed(m, r) ? '–' : m.fmt(r[c.key])) + '</td>'; }
      return '<td>' + C.esc(c.fmt(r[c.key])) + '</td>';
    }).join('') + '</tr>').join('');
    tbl.innerHTML = '<caption class="sr-only">' + C.esc(t('table_heading')) + '</caption><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>';
  }

  // --------------------------------------------------------------- statics
  function renderStatic() {
    I.setLang(state.lang);
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = I.lang() === 'fr' ? 'Cartographie de l’accès' : 'Primary Care Access Mapper';
    document.getElementById('data-badge').textContent = B.meta.synthetic ? t('synthetic_badge') : t('real_badge');
    document.getElementById('methods').innerHTML = t('methods_html');
    document.querySelectorAll('#f-lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === state.lang)));
    document.querySelectorAll('#wait-compare button').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === state.waitCompare)));
    const fc = document.getElementById('f-clinic');
    fc.innerHTML = '<option value="all">' + C.esc(t('all_clinics')) + '</option>' +
      B.clinics.map((c, i) => '<option value="' + i + '">' + C.esc(clinicName(c)) + '</option>').join('');
    fc.value = String(state.clinic);
    const opts = B.meta.months.map((m, i) => '<option value="' + i + '">' + C.esc(I.month(m)) + '</option>').join('');
    const ff = document.getElementById('f-from'), ft = document.getElementById('f-to');
    ff.innerHTML = opts; ft.innerHTML = opts; ff.value = String(state.m0); ft.value = String(state.m1);
    const mm = document.getElementById('map-metric');
    mm.innerHTML = METRICS.map((m) => '<option value="' + m.key + '">' + C.esc(t(m.label)) + '</option>').join('');
    mm.value = state.metric;
    const ti = document.getElementById('trend-indicator');
    ti.innerHTML = TRENDS.map((x) => '<option value="' + x.key + '">' + C.esc(t(x.label)) + '</option>').join('');
    ti.value = state.trend;
    document.getElementById('catchment-val').textContent = state.radius + ' km';
    document.getElementById('catchment').value = state.radius;
    document.getElementById('window-label').textContent = t('window_label') + ': ' + I.date(B.meta.window.start) + ' – ' + I.date(B.meta.window.end);
  }

  function renderAll() {
    areaData = computeAreas();
    terr = territoryValues(areaData.rows);
    renderKpis(); renderMap(); renderProfile(); renderEquity(); renderWaits(); renderTrends(); renderResources(); renderAreaTable();
  }

  // ------------------------------------------------------------ URL state
  function writeHash() {
    const p = ['lang=' + state.lang, 'clinic=' + (state.clinic === 'all' ? 'all' : B.clinics[state.clinic].id),
      'from=' + B.meta.months[state.m0], 'to=' + B.meta.months[state.m1], 'map=' + state.metric, 'r=' + state.radius];
    if (state.area) p.push('area=' + state.area);
    if (history.replaceState) history.replaceState(null, '', '#' + p.join('&'));
  }
  function readHash() {
    const h = {};
    (location.hash || '').replace(/^#/, '').split('&').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) h[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (h.lang === 'fr' || h.lang === 'en') state.lang = h.lang;
    else if ((navigator.language || '').slice(0, 2) === 'fr') state.lang = 'fr';
    const ci = B.clinics.map((c) => c.id).indexOf(h.clinic);
    if (ci >= 0) state.clinic = ci;
    const a = B.meta.months.indexOf(h.from), b = B.meta.months.indexOf(h.to);
    state.m0 = 0; state.m1 = B.meta.months.length - 1;
    if (a >= 0) state.m0 = a;
    if (b >= 0 && b >= state.m0) state.m1 = b;
    if (metric(h.map)) state.metric = h.map;
    if (+h.r >= 5 && +h.r <= 40) state.radius = +h.r;
    if (h.area && D.features.some((f) => f.properties.area_id === h.area)) state.area = h.area;
  }

  // --------------------------------------------------------------- events
  function bind() {
    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    on('f-clinic', 'change', (e) => { state.clinic = e.target.value === 'all' ? 'all' : +e.target.value; writeHash(); renderAll(); });
    on('f-from', 'change', (e) => { state.m0 = +e.target.value; if (state.m1 < state.m0) { state.m1 = state.m0; document.getElementById('f-to').value = state.m1; } writeHash(); renderAll(); });
    on('f-to', 'change', (e) => { state.m1 = +e.target.value; if (state.m0 > state.m1) { state.m0 = state.m1; document.getElementById('f-from').value = state.m0; } writeHash(); renderAll(); });
    on('map-metric', 'change', (e) => { state.metric = e.target.value; writeHash(); renderMap(); });
    on('trend-indicator', 'change', (e) => { state.trend = e.target.value; renderTrends(); });
    on('catchment', 'input', (e) => {
      state.radius = +e.target.value;
      document.getElementById('catchment-val').textContent = state.radius + ' km';
      areaData = computeAreas(); terr = territoryValues(areaData.rows);
      renderMap(); renderProfile(); renderEquity(); renderResources(); renderAreaTable();
    });
    on('catchment', 'change', writeHash);
    document.querySelectorAll('#f-lang button').forEach((b) => b.addEventListener('click', () => {
      state.lang = b.getAttribute('data-lang'); writeHash(); renderStatic(); renderAll();
    }));
    document.querySelectorAll('#wait-compare button').forEach((b) => b.addEventListener('click', () => {
      state.waitCompare = b.getAttribute('data-v');
      document.querySelectorAll('#wait-compare button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderWaits();
    }));
    document.getElementById('area-table').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-k]');
      if (btn) {
        const k = btn.getAttribute('data-k');
        if (state.sortKey === k) state.sortDir = -state.sortDir; else { state.sortKey = k; state.sortDir = 1; }
        renderAreaTable();
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if (tr) { state.area = tr.getAttribute('data-id'); writeHash(); renderMap(); renderProfile(); renderAreaTable(); }
    });
    let timer = null, lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(renderAll, 150);
    });
  }

  function showError(err) {
    document.getElementById('main').innerHTML = '<div class="card"><h3>Could not load data/dashboard.js</h3><p>' + C.esc(err.message || err) +
      '</p><p>Run <code>npm run demo</code> (or <code>node pipeline/build-data.js</code>) to build it, then reload.</p></div>';
  }

  load().then((bundle) => {
    B = bundle;
    prepare();
    readHash();
    renderStatic();
    bind();
    renderAll();
    window.__dashboardReady = true;
  }).catch(showError);
}());
