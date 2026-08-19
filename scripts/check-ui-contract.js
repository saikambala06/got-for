#!/usr/bin/env node
/**
 * Check that the parser UI reads keys the parser actually emits.
 *
 * This exists because of a real bug: the Overview panel read `p.personal`
 * while the adapter produced `p.person`, so every field on that panel rendered
 * as "not found" on a resume whose name, email and LinkedIn were showing in
 * the header immediately above it. Nothing threw, nothing logged, and the page
 * looked like a parser failure. A key that does not exist is silently
 * `undefined` in JavaScript, so only a check like this one catches it.
 *
 * Run: npm run check:ui
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const UI = path.join(ROOT, 'public', 'js', 'parser-ui.js');
const EXT = path.join(ROOT, 'browser-extension', 'parser-ui.js');
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'ajay.pdf');

function parserOutput() {
  const python = process.env.PYTHON || 'python3';
  const code = `
import sys, json, pathlib, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'api'))})
from _resume_parser.pipeline import parse_document
data = parse_document(pathlib.Path(${JSON.stringify(FIXTURE)}).read_bytes(), filename="ajay.pdf")
print(json.dumps(data))
`;
  return JSON.parse(execFileSync(python, ['-c', code], { maxBuffer: 32 * 1024 * 1024 }));
}

function report(label, values) {
  console.log(`${label.padEnd(26)} ${values.length ? values.join(', ') : '(none)'}`);
  return values.length;
}

const src = fs.readFileSync(UI, 'utf8');
const api = parserOutput();

// 1. Every `data.<key>` must be a key the API really returns.
const allowed = new Set([...Object.keys(api), 'ok', 'error', 'hint']);
const strayApiKeys = [...new Set([...src.matchAll(/\bdata\.([a-zA-Z_]+)/g)].map((m) => m[1]))]
  .filter((key) => !allowed.has(key));

// 2. Every `p.<key>` must be a key adapt() really produces.
const adapt = src.slice(src.indexOf('function adapt('), src.indexOf('function renderResult('));
const produced = new Set([...adapt.matchAll(/^\s{6}([a-zA-Z]+):/gm)].map((m) => m[1]));
const body = src.slice(src.indexOf('function renderResult('));
const strayViewKeys = [...new Set([...body.matchAll(/\bp\.([a-zA-Z_]+)/g)].map((m) => m[1]))]
  .filter((key) => !produced.has(key));

// 3. The extension ships a copy; the two must not drift.
const drift = fs.existsSync(EXT) && fs.readFileSync(EXT, 'utf8') !== src
  ? ['browser-extension/parser-ui.js differs from public/js/parser-ui.js']
  : [];

let bad = 0;
bad += report('unknown API keys:', strayApiKeys);
bad += report('unknown view keys:', strayViewKeys);
bad += report('copies out of sync:', drift);

if (bad) {
  console.error('\n✗ parser UI reads keys that do not exist — those fields render as "not found"');
  process.exit(1);
}
console.log('\n✓ parser UI contract holds');
