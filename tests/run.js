#!/usr/bin/env node
// Test runner with no dependencies: node tests/run.js
// Each *.test.js file exports a function (test) => void that registers cases.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
test.near = (actual, expected, tol, msg) => {
  if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol))) {
    throw new assert.AssertionError({ message: (msg ? msg + ': ' : '') + 'expected ' + expected + ', got ' + actual, actual, expected, operator: 'near' });
  }
};

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
for (const f of files) {
  const before = cases.length;
  require(path.join(__dirname, f))(test, assert);
  for (let i = before; i < cases.length; i++) cases[i].file = f;
}

let failed = 0;
for (const c of cases) {
  try {
    c.fn();
    console.log('  ok    ' + c.file.replace('.test.js', '') + ' › ' + c.name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + c.file.replace('.test.js', '') + ' › ' + c.name + '\n        ' + (e && e.message ? e.message : e));
  }
}
console.log('\n' + (cases.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
