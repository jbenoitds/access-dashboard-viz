// Pipeline tests: build-data on a hand-computed fixture, and consistency of
// the committed demo bundle with the emr_access engine output inside it.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const M = require('../js/metrics');

const ROOT = path.resolve(__dirname, '..');

function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-'));
  const out = path.join(dir, 'bundle.json');
  childProcess.execFileSync(process.execPath, [path.join(ROOT, 'pipeline/build-data.js'),
    '--territory', path.join(__dirname, 'fixtures/territory'), '--raw', path.join(__dirname, 'fixtures/raw'),
    '--engine', 'none', '--out', out, '--generated', '2000-01-01'], { stdio: 'pipe' });
  const b = JSON.parse(fs.readFileSync(out, 'utf8'));
  const js = fs.readFileSync(path.join(dir, 'bundle.js'), 'utf8');
  return { b, js };
}

function loadDemo() {
  const file = path.join(ROOT, 'data/dashboard.js');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

module.exports = (test, assert) => {
  const fx = buildFixture();
  const b = fx.b;
  const F = M.fieldIndex(b);
  const all = { clinics: null, m0: 0, m1: b.meta.months.length - 1 };

  test('fixture: window, months and the script wrapper', () => {
    assert.deepStrictEqual(b.meta.window, { start: '2022-03-03', end: '2022-05-31' });
    assert.deepStrictEqual(b.meta.months, ['2022-03', '2022-04', '2022-05']);
    assert.ok(/^\/\/ Generated[^\n]*\nwindow\.DASHBOARD_DATA = \{/.test(fx.js));
    assert.strictEqual(b.meta.unknown_area_patients, 1);
  });

  test('fixture: provider types accept French aliases', () => {
    assert.deepStrictEqual(b.providers.map((p) => p.type), ['physician', 'physician', 'resident', 'nurse', 'physician']);
    assert.deepStrictEqual(b.clinics[0].providers, { physician: 2, resident: 1, nurse: 1 });
  });

  test('fixture: registration snapshot by area and clinic', () => {
    assert.deepStrictEqual(b.registered, [[1, 0], [1, 1]]);
    assert.deepStrictEqual(b.registered_unknown_area, [1, 0]);
    assert.deepStrictEqual(b.unattached_users, [[0, 0], [1, 1]]);
  });

  test('fixture: count cube totals match the hand count', () => {
    const x = M.sumCube(b, all, () => 'x').get('x');
    const got = {};
    b.cube.fields.forEach((f, i) => { got[f] = x[i]; });
    assert.deepStrictEqual(got, {
      visits: 12, doctor_visits: 11, walk_ins: 5, reg_doctor_visits: 7, reg_with_r: 5, reg_walk_ins: 1,
      no_shows: 2, no_show_den: 9, unregistered_visits: 3, wait_n: 7, wait_days: 266,
    });
  });

  test('fixture: area West and clinic filters', () => {
    const w = M.sumCube(b, all, (a) => a).get(0);
    assert.strictEqual(w[F.visits], 4);
    assert.strictEqual(w[F.walk_ins], 1);
    assert.strictEqual(w[F.reg_doctor_visits], 4);
    assert.strictEqual(w[F.reg_with_r], 2);
    const c2 = M.sumCube(b, { clinics: [1], m0: 0, m1: 2 }, () => 'x').get('x');
    assert.strictEqual(c2[F.visits], 2);           // visits 7 and 10
    const april = M.sumCube(b, { clinics: null, m0: 1, m1: 1 }, () => 'x').get('x');
    assert.strictEqual(april[F.unregistered_visits], 3);
    assert.strictEqual(april[F.no_shows], 1);
  });

  test('fixture: wait-time counts, overflow bin and exact mean', () => {
    const counts = M.sumWaits(b, all, () => 'x').get('x');
    assert.strictEqual(M.countsTotal(counts), 7);
    assert.strictEqual(counts[2], 2);
    assert.strictEqual(counts[b.waits.max_days + 1], 1);     // 181 days -> overflow
    assert.strictEqual(M.countsQuantile(counts, 0.5), 7);
    const x = M.sumCube(b, all, () => 'x').get('x');
    test.near(x[F.wait_days] / x[F.wait_n], 266 / 7);
  });

  test('fixture: distances from area centres to clinics', () => {
    test.near(b.dist_km[0][0], 0, 0.01);
    test.near(b.dist_km[1][1], 0.394, 0.01);
    assert.strictEqual(b.clinics[0].area_id, 'W');
  });

  const demo = loadDemo();
  if (!demo) return;
  const DF = M.fieldIndex(demo);
  const dall = { clinics: null, m0: 0, m1: demo.meta.months.length - 1 };
  const engine = (ind, clinic, period) => M.findSeries(demo, { indicator: ind, level: 'clinic', clinic, period });

  test('demo bundle: shape and synthetic flag', () => {
    assert.strictEqual(demo.version, 1);
    assert.strictEqual(demo.meta.synthetic, true);
    const s = demo.cube.shape;
    assert.strictEqual(demo.cube.data.length, s[0] * s[1] * s[2] * s[3]);
    assert.strictEqual(s[0], demo.areas.features.length + 1);
    assert.strictEqual(demo.dist_km.length, demo.areas.features.length);
    assert.ok(demo.engine && demo.engine.series.length > 100);
  });

  test('demo bundle: wait medians and p90 equal emr_access for every clinic and month', () => {
    const byCm = M.sumWaits(demo, dall, (a, c, m) => c + '|' + m);
    const byC = M.sumWaits(demo, dall, (a, c) => c);
    let checked = 0;
    demo.clinics.forEach((c, ci) => {
      const win = byC.get(ci);
      test.near(M.countsQuantile(win, 0.5), engine('wait_time_median_days', c.id, 'window').points[0][1], 0.005, c.id + ' median');
      test.near(M.countsQuantile(win, 0.9), engine('wait_time_p90_days', c.id, 'window').points[0][1], 0.005, c.id + ' p90');
      engine('wait_time_median_days', c.id, 'month').points.forEach((p) => {
        const mi = demo.meta.months.indexOf(p[0].slice(0, 7));
        test.near(M.countsQuantile(byCm.get(ci + '|' + mi), 0.5), p[1], 0.005, c.id + ' ' + p[0]);
        checked++;
      });
    });
    assert.ok(checked >= demo.clinics.length * 12);
  });

  test('demo bundle: no-show, continuity, walk-in and mean wait equal emr_access', () => {
    const byC = M.sumCube(demo, dall, (a, c) => c);
    demo.clinics.forEach((c, ci) => {
      const x = byC.get(ci);
      const pair = (ind) => engine(ind, c.id, 'window').points[0].slice(2, 4);
      assert.deepStrictEqual([x[DF.no_shows], x[DF.no_show_den]], pair('no_show_rate'), c.id + ' no-show');
      assert.deepStrictEqual([x[DF.reg_with_r], x[DF.reg_doctor_visits]], pair('relational_continuity'), c.id + ' continuity');
      assert.deepStrictEqual([x[DF.reg_walk_ins], x[DF.reg_doctor_visits]], pair('walk_in_use'), c.id + ' walk-in');
      test.near(x[DF.wait_days] / x[DF.wait_n], engine('wait_time_mean_days', c.id, 'window').points[0][1], 0.005, c.id + ' mean wait');
    });
  });

  test('demo bundle: registered patients equal the demand table', () => {
    demo.clinics.forEach((c, ci) => {
      const reg = demo.registered.reduce((s, r) => s + r[ci], 0) + demo.registered_unknown_area[ci];
      const row = demo.engine.demand_supply.filter((r) => r.level === 'clinic' && r.clinic_id === c.id)[0];
      assert.strictEqual(reg, row.patients_total, c.id);
    });
  });

  test('demo bundle: pooled monthly proportions re-aggregate to the window value', () => {
    demo.clinics.forEach((c) => {
      const pooled = M.pooledProportion([engine('relational_continuity', c.id, 'month')], demo.meta.months, 0, demo.meta.months.length - 1);
      test.near(pooled.value, engine('relational_continuity', c.id, 'window').points[0][1], 0.00005, c.id);
    });
  });

  test('demo territory: quintiles are population-balanced and attachment falls with deprivation', () => {
    const pop = [0, 0, 0, 0, 0, 0], att = [0, 0, 0, 0, 0, 0];
    demo.areas.features.forEach((f) => {
      const q = f.properties.deprivation_quintile;
      pop[q] += f.properties.population; att[q] += f.properties.attachment_rate * f.properties.population;
    });
    const total = pop.reduce((s, x) => s + x, 0);
    for (let q = 1; q <= 5; q++) assert.ok(Math.abs(pop[q] / total - 0.2) < 0.08, 'Q' + q + ' share ' + pop[q] / total);
    assert.ok(att[1] / pop[1] > att[5] / pop[5]);
  });
};
