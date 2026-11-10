#!/usr/bin/env node
// run-engine.js - runs emr_access (from the companion repository
// emr-access-indicators) on the extracts in data/raw and writes its output to
// data/engine.
//
// The executable is looked for in, in order:
//   --engine-bin PATH, the EMR_ACCESS environment variable,
//   ../emr-access-indicators/build/emr_access[.exe] and
//   ../emr-access-indicators/build/Release/emr_access.exe (Visual Studio).
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const opt = { raw: path.join(ROOT, 'data/raw'), out: path.join(ROOT, 'data/engine'), bin: process.env.EMR_ACCESS || null,
  from: '2021-08-01', to: '2022-07-31' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], v = process.argv[i + 1];
  if (a === '--engine-bin') { opt.bin = v; i++; }
  else if (a === '--raw') { opt.raw = path.resolve(v); i++; }
  else if (a === '--out') { opt.out = path.resolve(v); i++; }
  else if (a === '--from') { opt.from = v; i++; }
  else if (a === '--to') { opt.to = v; i++; }
  else { console.error('run-engine: unknown option ' + a); process.exit(2); }
}

const sibling = path.resolve(ROOT, '..', 'emr-access-indicators', 'build');
const candidates = (opt.bin ? [opt.bin] : []).concat([
  path.join(sibling, 'emr_access'), path.join(sibling, 'emr_access.exe'),
  path.join(sibling, 'Release', 'emr_access.exe'), path.join(sibling, 'Release', 'emr_access'),
]);
const bin = candidates.filter((c) => fs.existsSync(c))[0];
if (!bin) {
  console.error('run-engine: emr_access was not found. Build emr-access-indicators next to this folder\n' +
    '  (cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release)\n' +
    'or pass --engine-bin PATH / set EMR_ACCESS. Looked in:\n  ' + candidates.join('\n  '));
  process.exit(1);
}
const args = ['--data-dir', opt.raw, '--out', opt.out, '--format', 'csv', '--from', opt.from, '--to', opt.to, '--strict'];
console.error('run-engine: ' + bin + ' ' + args.join(' '));
const r = childProcess.spawnSync(bin, args, { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
