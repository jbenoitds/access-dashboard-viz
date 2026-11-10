// metrics.js - the dashboard's calculations, kept free of DOM code so the
// same file runs in the browser (window.Metrics) and under Node (tests).
//
//   percentileInc       PERCENTILE.INC / numpy default, as in emr_access
//   countsQuantile      the same percentile computed from a histogram
//   e2sfca              enhanced two-step floating catchment area accessibility
//   Bundle helpers      filter and aggregate the count cube and wait counts
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Metrics = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------ percentiles
  // Linear interpolation between closest ranks: h = (N - 1) p.
  function percentileInc(sorted, p) {
    if (!sorted.length) return NaN;
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  }

  // counts[d] = number of observations equal to d (d = 0, 1, 2, ...).
  // Returns the value percentileInc would give on the expanded sample.
  function countsQuantile(counts, p) {
    let total = 0;
    for (let d = 0; d < counts.length; d++) total += counts[d] || 0;
    if (!total) return NaN;
    const h = (total - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    let vLo = NaN, vHi = NaN, cum = 0;
    for (let d = 0; d < counts.length; d++) {
      const c = counts[d] || 0;
      if (!c) continue;
      if (isNaN(vLo) && lo < cum + c) vLo = d;
      if (hi < cum + c) { vHi = d; break; }
      cum += c;
    }
    return vLo + (h - lo) * (vHi - vLo);
  }

  function countsTotal(counts) {
    let t = 0;
    for (let d = 0; d < counts.length; d++) t += counts[d] || 0;
    return t;
  }

  function countsMean(counts) {
    let t = 0, s = 0;
    for (let d = 0; d < counts.length; d++) { t += counts[d] || 0; s += d * (counts[d] || 0); }
    return t ? s / t : NaN;
  }

  // Share of observations <= d, for d = 0 .. counts.length - 1.
  function countsEcdf(counts) {
    const total = countsTotal(counts);
    const out = new Array(counts.length);
    let cum = 0;
    for (let d = 0; d < counts.length; d++) { cum += counts[d] || 0; out[d] = total ? cum / total : NaN; }
    return out;
  }

  // ----------------------------------------------------------------- E2SFCA
  // Luo & Qi (2009) enhanced 2SFCA with a Gaussian distance decay truncated
  // at the catchment radius d0 (weight 1 at the clinic, 0 at d0):
  //   step 1  R_j = S_j / sum_k P_k W(d_kj)          supply-to-demand ratio
  //   step 2  A_i = sum_j R_j W(d_ij)                accessibility of area i
  // pop[i] residents of area i, supply[j] e.g. physicians at clinic j,
  // dist[i][j] km. Returns { access: [...], ratio: [...] }, access per resident.
  function gaussianWeight(d, d0) {
    if (d > d0) return 0;
    const e = Math.exp(-0.5);
    return (Math.exp(-0.5 * (d / d0) * (d / d0)) - e) / (1 - e);
  }

  function e2sfca(pop, supply, dist, d0) {
    const n = pop.length, m = supply.length;
    const ratio = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let demand = 0;
      for (let k = 0; k < n; k++) demand += pop[k] * gaussianWeight(dist[k][j], d0);
      ratio[j] = demand > 0 ? supply[j] / demand : 0;
    }
    const access = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let j = 0; j < m; j++) a += ratio[j] * gaussianWeight(dist[i][j], d0);
      access[i] = a;
    }
    return { access, ratio };
  }

  // ------------------------------------------------------- bundle helpers
  // filter = { clinics: array of clinic indices (null = all),
  //            m0, m1: inclusive month indices }
  function inFilter(filter, c, m) {
    return m >= filter.m0 && m <= filter.m1 && (!filter.clinics || filter.clinics.indexOf(c) !== -1);
  }

  // Sum the cube by a key function key(areaIndex, clinicIndex) -> group key
  // (or null to drop). Returns Map key -> array of field sums.
  function sumCube(bundle, filter, key) {
    const shape = bundle.cube.shape, data = bundle.cube.data;
    const A = shape[0], NC = shape[1], NM = shape[2], NF = shape[3];
    const out = new Map();
    for (let a = 0; a < A; a++) {
      for (let c = 0; c < NC; c++) {
        const k = key(a, c);
        if (k === null || k === undefined) continue;
        let acc = out.get(k);
        for (let m = filter.m0; m <= filter.m1; m++) {
          if (!inFilter(filter, c, m)) continue;
          const base = ((a * NC + c) * NM + m) * NF;
          if (!acc) { acc = new Array(NF).fill(0); out.set(k, acc); }
          for (let f = 0; f < NF; f++) acc[f] += data[base + f];
        }
      }
    }
    return out;
  }

  // Wait-time counts by group: Map key -> counts array (index = days).
  function sumWaits(bundle, filter, key) {
    const w = bundle.waits, size = w.max_days + 2;
    const out = new Map();
    for (let i = 0; i < w.n.length; i++) {
      if (!inFilter(filter, w.c[i], w.m[i])) continue;
      const k = key(w.a[i], w.c[i], w.m[i]);
      if (k === null || k === undefined) continue;
      let counts = out.get(k);
      if (!counts) { counts = new Array(size).fill(0); out.set(k, counts); }
      counts[w.d[i]] += w.n[i];
    }
    return out;
  }

  function fieldIndex(bundle) {
    const f = {};
    bundle.cube.fields.forEach(function (name, i) { f[name] = i; });
    return f;
  }

  function ratio(num, den) { return den > 0 ? num / den : NaN; }

  function weightedMean(values, weights) {
    let s = 0, w = 0;
    for (let i = 0; i < values.length; i++) {
      if (isNaN(values[i]) || !(weights[i] > 0)) continue;
      s += values[i] * weights[i]; w += weights[i];
    }
    return w ? s / w : NaN;
  }

  // Engine series lookup: { indicator, level, clinic, provider, period }.
  function findSeries(bundle, q) {
    if (!bundle.engine) return null;
    const s = bundle.engine.series;
    for (let i = 0; i < s.length; i++) {
      const x = s[i];
      if (x.indicator === q.indicator && x.level === q.level && x.clinic === q.clinic &&
          (q.provider === undefined || x.provider === q.provider) && x.period === q.period) return x;
    }
    return null;
  }

  // Re-aggregate a proportion over clinics and months from numerators and
  // denominators (never averaging rates). Points whose period_start month is
  // outside [m0, m1] are ignored. Returns { value, num, den }.
  function pooledProportion(seriesList, months, m0, m1) {
    let num = 0, den = 0;
    seriesList.forEach(function (s) {
      if (!s) return;
      s.points.forEach(function (p) {
        const mi = months.indexOf(p[0].slice(0, 7));
        if (mi < m0 || mi > m1 || p[2] === null || p[3] === null) return;
        num += p[2]; den += p[3];
      });
    });
    return { value: ratio(num, den), num: num, den: den };
  }

  return {
    percentileInc: percentileInc, countsQuantile: countsQuantile, countsTotal: countsTotal,
    countsMean: countsMean, countsEcdf: countsEcdf, gaussianWeight: gaussianWeight, e2sfca: e2sfca,
    sumCube: sumCube, sumWaits: sumWaits, fieldIndex: fieldIndex, ratio: ratio, weightedMean: weightedMean,
    findSeries: findSeries, pooledProportion: pooledProportion, inFilter: inFilter,
  };
}));
