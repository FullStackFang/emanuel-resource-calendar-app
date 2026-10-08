#!/usr/bin/env node
'use strict';

/**
 * Compare two Jest `--json` result files by test name.
 *
 * The suite is red on main, so "did my change break anything?" cannot be
 * answered by counts alone: a fix and a regression of equal size cancel out.
 * This reports every test whose pass/fail state differs between the two runs,
 * plus tests that exist in only one of them.
 *
 * Usage:
 *   node scripts/diff-jest-results.js <before.json> <after.json>
 *
 * Exit code is 1 when any test regressed (passed before, not passing after),
 * 0 otherwise — so it can gate a script.
 */

const fs = require('fs');
const path = require('path');

function loadResults(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byName = new Map();
  for (const suite of raw.testResults || []) {
    const suiteName = path.basename(suite.name || suite.testFilePath || 'unknown');
    // A suite that failed to run at all has no assertionResults; record it as
    // one synthetic entry so a newly-broken file is not silently invisible.
    if (!suite.assertionResults || suite.assertionResults.length === 0) {
      byName.set(`${suiteName} :: <suite>`, suite.status === 'passed' ? 'passed' : 'failed');
      continue;
    }
    for (const a of suite.assertionResults) {
      const title = [...(a.ancestorTitles || []), a.title].join(' > ');
      byName.set(`${suiteName} :: ${title}`, a.status);
    }
  }
  return byName;
}

function diffResults(before, after) {
  const regressed = [];
  const fixed = [];
  const changed = [];
  const added = [];
  const removed = [];

  for (const [name, status] of after) {
    if (!before.has(name)) {
      added.push({ name, status });
      continue;
    }
    const prev = before.get(name);
    if (prev === status) continue;
    if (prev === 'passed') regressed.push({ name, from: prev, to: status });
    else if (status === 'passed') fixed.push({ name, from: prev, to: status });
    else changed.push({ name, from: prev, to: status });
  }
  for (const [name, status] of before) {
    if (!after.has(name)) removed.push({ name, status });
  }
  return { regressed, fixed, changed, added, removed };
}

function count(map, status) {
  let n = 0;
  for (const s of map.values()) if (s === status) n += 1;
  return n;
}

function main(argv) {
  const [beforeFile, afterFile] = argv;
  if (!beforeFile || !afterFile) {
    console.error('Usage: node scripts/diff-jest-results.js <before.json> <after.json>');
    return 2;
  }
  const before = loadResults(beforeFile);
  const after = loadResults(afterFile);
  const d = diffResults(before, after);

  console.log(`before: ${count(before, 'passed')} passed / ${count(before, 'failed')} failed`);
  console.log(`after:  ${count(after, 'passed')} passed / ${count(after, 'failed')} failed`);
  const sections = [
    ['REGRESSED (passed -> not passed)', d.regressed, x => `${x.name}  [${x.from} -> ${x.to}]`],
    ['FIXED (not passed -> passed)', d.fixed, x => `${x.name}  [${x.from} -> ${x.to}]`],
    ['OTHER STATE CHANGE', d.changed, x => `${x.name}  [${x.from} -> ${x.to}]`],
    ['ADDED', d.added, x => `${x.name}  [${x.status}]`],
    ['REMOVED', d.removed, x => `${x.name}  [${x.status}]`],
  ];
  for (const [title, list, fmt] of sections) {
    console.log(`\n${title}: ${list.length}`);
    for (const x of list) console.log(`  ${fmt(x)}`);
  }
  return d.regressed.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { loadResults, diffResults };
