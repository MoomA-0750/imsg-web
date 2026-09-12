#!/usr/bin/env node
// Generate the Phase F / F1 script: the first execution of a built product.
//
// A third generator, for the same reason there was a second. The probe
// generator forbids every write and the Phase D generator forbids executing the
// product; F1 must execute the product exactly once. Weakening either of those
// to cover this case would retroactively weaken everything they have signed off.
//
// Usage:
//   node scripts/gen-phase-f.mjs --role intel|m1 --product /abs/path/imsg \
//        --home /abs --tmp /abs --cwd /abs --out /path/out.sh

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(message) {
  console.error(`gen-phase-f: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) fail(`expected an option, got ${key}`);
    if (argv[i + 1] === undefined) fail(`option ${key} has no value`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

const UNSAFE = /['"`$;\\\n\r&|<>()*?[\]{}!#]/;
function checkPath(value, label) {
  if (!value) fail(`${label} is required`);
  if (!value.startsWith('/')) fail(`${label} must be an absolute path`);
  if (UNSAFE.test(value)) fail(`${label} contains a character that is unsafe to substitute`);
  if (value.endsWith('/')) fail(`${label} must not have a trailing slash`);
  if (value.includes('/..')) fail(`${label} must not contain ..`);
}

const args = parseArgs(process.argv.slice(2));
const { role, product, home, tmp, cwd, out } = args;
if (role !== 'intel' && role !== 'm1') fail('--role must be intel or m1');
for (const [v, l] of [[product, '--product'], [home, '--home'], [tmp, '--tmp'], [cwd, '--cwd'], [out, '--out']]) checkPath(v, l);

// BridgeHelperLocator searches `.build/release/<helper>` relative to the working
// directory, so a cwd inside a build tree changes which helper could be found.
if (/(^|\/)\.build(\/|$)/.test(cwd)) fail('--cwd must not be inside a build tree');
if (!product.includes('/imsg-web/')) fail('--product must be a project-owned artifact');

const templatePath = resolve(dirname(new URL(import.meta.url).pathname), 'phase-f-f1.sh.template');
const script = readFileSync(templatePath, 'utf8')
  .replaceAll('@@PRODUCT@@', product)
  .replaceAll('@@RUNHOME@@', home)
  .replaceAll('@@RUNTMP@@', tmp)
  .replaceAll('@@RUNCWD@@', cwd)
  .replaceAll('@@ROLE@@', role);

if (script.includes('@@')) fail('an unsubstituted marker remains');

const codeOnly = script
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .replace(/\\\n\s*/g, ' ');

// F1 writes nothing at all, so any redirection other than reading /dev/null,
// and any command that creates, is refused outright.
for (const [pattern, label] of [
  [/(^|[^-&>])([0-9]?)>>?\s*[^\s&]/m, 'any output redirection'],
  [/\blaunchctl\b|\btailscale\b|\bbrew\b|\bsudo\b/, 'forbidden tool'],
  [/2>\s*\/dev\/null/, 'discarded stderr'],
  [/\brpc\b|--db\b/, 'a rung beyond F1'],
]) if (pattern.test(codeOnly)) fail(`generated script contains ${label}`);

const ALLOWED = new Set([
  'echo', 'date', 'stat', 'shasum', 'file', 'xattr', 'codesign', 'ps', 'ls',
  'log', 'test', '[', 'set', 'export', 'exit',
]);
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', '!']);

// Exactly one execution is permitted, and only in this exact shape.
const RUN_SHAPE = new RegExp(
  '^/usr/bin/env -i HOME="\\$\\{RUNHOME\\}" PATH=/usr/bin:/bin:/usr/sbin:/sbin '
  + 'TMPDIR="\\$\\{RUNTMP\\}" LANG=en_US\\.UTF-8 LC_ALL=en_US\\.UTF-8 '
  + '"\\$\\{PRODUCT\\}" --version < /dev/null$',
);

let runs = 0;
for (const rawLine of codeOnly.split('\n')) {
  const line = rawLine.trim();
  if (!line) continue;
  for (const rawSegment of line.split(/\|\||&&|[;|]|(?<!>)&/)) {
    let segment = rawSegment.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*=('[^']*'|"[^"]*"|\S*)$/.test(segment)) continue;
    for (let g = 0; g < 8; g += 1) {
      const w = segment.split(/\s/)[0];
      if (w && KEYWORDS.has(w)) { segment = segment.slice(w.length).trim(); continue; }
      break;
    }
    const word = segment.split(/\s/)[0];
    if (!word) continue;
    if (word.startsWith('/usr/bin/env')) {
      if (!RUN_SHAPE.test(segment)) fail(`the execution is not the approved shape: ${segment}`);
      runs += 1;
      continue;
    }
    const bare = word.replace(/^["']|["']$/g, '');
    if (bare.includes('$')) fail(`command name comes from a variable: ${segment}`);
    if (bare.includes('/')) fail(`command executed by path: ${bare}`);
    if (!ALLOWED.has(bare)) fail(`command not on the allow-list: ${bare}`);
  }
}
if (runs !== 1) fail(`expected exactly one execution, found ${runs}`);

const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}
writeFileSync(outPath, script, { mode: 0o600 });
console.log(`wrote ${outPath.split('/').pop()}`);
console.log(`role=${role} executions=${runs} bytes=${script.length}`);
