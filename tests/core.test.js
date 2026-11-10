// Unit tests: calendar arithmetic, CSV, geodesy, percentiles, E2SFCA.
'use strict';

const C = require('../pipeline/lib/common');
const M = require('../js/metrics');

module.exports = (test, assert) => {
  test('days_from_civil round-trips 1900-2100 and matches known dates', () => {
    assert.strictEqual(C.daysFromCivil(1970, 1, 1), 0);
    assert.strictEqual(C.daysFromCivil(2000, 3, 1), 11017);
    assert.strictEqual(C.formatDate(C.daysFromCivil(2024, 2, 29)), '2024-02-29');
    for (let d = C.daysFromCivil(1900, 1, 1); d <= C.daysFromCivil(2100, 12, 31); d += 37) {
      const c = C.civilFromDays(d);
      assert.strictEqual(C.daysFromCivil(c.year, c.month, c.day), d);
    }
  });

  test('weekday: 2022-03-01 is a Tuesday (1), 1970-01-01 a Thursday (3)', () => {
    assert.strictEqual(C.weekday(C.daysFromCivil(2022, 3, 1)), 1);
    assert.strictEqual(C.weekday(0), 3);
  });

  test('timestamps parse in all accepted forms and reject bad ones', () => {
    assert.strictEqual(C.parseTimestamp('2022-03-01'), C.daysFromCivil(2022, 3, 1) * 1440);
    assert.strictEqual(C.parseTimestamp('2022-03-01 08:20'), C.daysFromCivil(2022, 3, 1) * 1440 + 500);
    assert.strictEqual(C.parseTimestamp('2022-03-01T08:20:59'), C.daysFromCivil(2022, 3, 1) * 1440 + 500);
    assert.strictEqual(C.parseTimestamp(''), null);
    assert.strictEqual(C.parseTimestamp('2022-13-01'), null);
    assert.strictEqual(C.parseTimestamp('01/03/2022'), null);
    assert.strictEqual(C.formatTimestamp(C.parseTimestamp('2021-08-03 07:00')), '2021-08-03 07:00');
  });

  test('CSV: BOM, CRLF, quotes, embedded delimiters/newlines, semicolons', () => {
    const r = C.parseCsv('\ufeffA,B,C\r\n1,"x, ""y""",3\r\n2,"multi\nline",\r\n');
    assert.deepStrictEqual(r.header, ['a', 'b', 'c']);
    assert.deepStrictEqual(r.rows, [['1', 'x, "y"', '3'], ['2', 'multi\nline', '']]);
    const s = C.parseCsv('id;name\n1;Montréal\n');
    assert.deepStrictEqual(s.rows, [['1', 'Montréal']]);
    assert.strictEqual(C.csvEscape('a,b'), '"a,b"');
    assert.strictEqual(C.csvEscape('say "hi"'), '"say ""hi"""');
  });

  test('haversine: 1 degree of latitude is ~111.2 km; a quarter meridian is ~10,008 km', () => {
    test.near(C.haversineKm(0, 0, 0, 1), 111.195, 0.01);
    test.near(C.haversineKm(10, 0, 10, 90), 10007.5, 1);
    test.near(C.haversineKm(-40, 45, -39, 45), 78.626, 0.001); // 1 deg of longitude at 45N (great circle)
  });

  test('ring area and centroid of a 0.01 x 0.01 degree square at 45N', () => {
    const r = C.ringAreaCentroid([[-40.01, 45], [-40, 45], [-40, 45.01], [-40.01, 45.01], [-40.01, 45]]);
    test.near(r.areaKm2, 0.01 * 111.32 * Math.cos(45.005 * Math.PI / 180) * 0.01 * 110.574, 1e-3);
    test.near(r.centroid[0], -40.005, 1e-6);
    test.near(r.centroid[1], 45.005, 1e-6);
    assert.ok(C.pointInRing([-40.005, 45.005], [[-40.01, 45], [-40, 45], [-40, 45.01], [-40.01, 45.01]]));
    assert.ok(!C.pointInRing([-39.9, 45.005], [[-40.01, 45], [-40, 45], [-40, 45.01], [-40.01, 45.01]]));
  });

  test('seeded PRNG is deterministic and roughly uniform', () => {
    const a = C.makeRng(7), b = C.makeRng(7);
    for (let i = 0; i < 100; i++) assert.strictEqual(a.uniform(), b.uniform());
    const r = C.makeRng(1);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += r.uniform();
    test.near(s / 20000, 0.5, 0.01);
  });

  test('percentileInc matches Excel PERCENTILE.INC / numpy', () => {
    const v = [1, 2, 3, 4, 10];
    assert.strictEqual(M.percentileInc(v, 0.5), 3);
    test.near(M.percentileInc(v, 0.9), 7.6);   // h = 3.6 -> 4 + 0.6 * 6
    test.near(M.percentileInc([5], 0.9), 5);
    assert.ok(isNaN(M.percentileInc([], 0.5)));
  });

  test('countsQuantile equals percentileInc on the expanded sample', () => {
    const r = C.makeRng(3);
    for (let trial = 0; trial < 200; trial++) {
      const counts = new Array(30).fill(0);
      const sample = [];
      const n = 1 + r.integer(0, 60);
      for (let i = 0; i < n; i++) { const d = Math.floor(r.exponential(5)) % 30; counts[d]++; sample.push(d); }
      sample.sort((x, y) => x - y);
      for (const p of [0, 0.1, 0.5, 0.9, 1]) test.near(M.countsQuantile(counts, p), M.percentileInc(sample, p), 1e-9, 'p=' + p);
      test.near(M.countsMean(counts), sample.reduce((s, x) => s + x, 0) / n, 1e-9);
    }
  });

  test('ECDF of counts ends at 1 and is non-decreasing', () => {
    const e = M.countsEcdf([2, 0, 1, 1]);
    assert.deepStrictEqual(e, [0.5, 0.5, 0.75, 1]);
  });

  test('Gaussian catchment weight: 1 at the clinic, 0 at and beyond the radius', () => {
    assert.strictEqual(M.gaussianWeight(0, 10), 1);
    test.near(M.gaussianWeight(10, 10), 0);
    assert.strictEqual(M.gaussianWeight(10.1, 10), 0);
    assert.ok(M.gaussianWeight(5, 10) > 0.5 && M.gaussianWeight(5, 10) < 0.8);
  });

  test('E2SFCA: hand-computed two-area, two-clinic example', () => {
    // Clinic 0 (2 physicians) is next to area 0 and 6 km from area 1;
    // clinic 1 (1 physician) is next to area 1 only. Radius 10 km.
    const pop = [1000, 3000], supply = [2, 1], dist = [[0, 20], [6, 0]];
    const w6 = M.gaussianWeight(6, 10);
    const r0 = 2 / (1000 + 3000 * w6), r1 = 1 / 3000;
    const out = M.e2sfca(pop, supply, dist, 10);
    test.near(out.ratio[0], r0); test.near(out.ratio[1], r1);
    test.near(out.access[0], r0); test.near(out.access[1], r0 * w6 + r1);
    // total accessibility x population = total supply when every population is covered
    const covered = M.e2sfca([500, 500], [3, 1], [[0, 1], [1, 0]], 30);
    test.near(covered.access[0] * 500 + covered.access[1] * 500, 4, 1e-9);
  });
};
