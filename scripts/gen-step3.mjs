#!/usr/bin/env node
// Generate a Step3 rung script.
//
// The fourth generator, for the fourth contract. The three that exist are each
// narrower in a way that matters and none of them can be widened to cover this
// without retroactively weakening every script it has already signed off:
//
//   gen-phase-a.mjs  read-only; refuses every write
//   gen-phase-d.mjs  writes under a build root; refuses executing the product
//   gen-phase-f.mjs  executes the product exactly once; refuses every write
//
// A step3 rung needs to write AND execute: it stages a private fixture and then
// runs the product against it. That combination is new, so it gets a new
// contract rather than a relaxation of an old one.
//
// The contract:
//   - every write names a path under the private run root
//   - exactly one execution of the product, in one approved shape
//   - the database is a fixture under the run root. A path under
//     Library/Messages is refused outright, by this generator, in this pass.
//   - no signalling, no launchctl, no network, no deletion
//
// Usage:
//   node scripts/gen-step3.mjs --pass decoy --role m1 --product /abs/imsg \
//        --home /abs --tmp /abs --cwd /abs --fixture /abs/f.db --out /path/out.sh

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(message) {
  console.error(`gen-step3: ${message}`);
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
  if (value.length > 512) fail(`${label} is implausibly long`);
  if (UNSAFE.test(value)) fail(`${label} contains a character that is unsafe to substitute`);
  if (value.endsWith('/')) fail(`${label} must not have a trailing slash`);
  if (value.includes('/..')) fail(`${label} must not contain ..`);
}

const args = parseArgs(process.argv.slice(2));
const { role, product, home, tmp, cwd, fixture, out } = args;
const pass = args.pass;

if (!['decoy', 'contacts'].includes(pass)) fail('--pass must be decoy or contacts');
if (role !== 'm1') fail('--role must be m1: Intel execution is not decided');

// The `contacts` rung runs twice, once per arm of its own comparison. Without
// the control arm a `false` cannot be told apart from a flag that does nothing.
const contactsSource = args['contacts-source'];
if (pass === 'contacts') {
  if (!['auto', 'addressbook'].includes(contactsSource ?? '')) {
    fail('--contacts-source must be auto (control) or addressbook');
  }
} else if (contactsSource !== undefined) {
  fail('--contacts-source is meaningless outside the contacts pass');
}
const CONTACTS_FLAG = contactsSource === 'addressbook' ? ' --contacts-from-address-book' : '';
for (const [v, l] of [[product, '--product'], [home, '--home'], [tmp, '--tmp'],
  [cwd, '--cwd'], [fixture, '--fixture'], [out, '--out']]) checkPath(v, l);

// BridgeHelperLocator searches `.build/release/<helper>` relative to the working
// directory, so a cwd inside a build tree changes which helper could be found.
if (/(^|\/)\.build(\/|$)/.test(cwd)) fail('--cwd must not be inside a build tree');
if (!product.includes('/imsg-web/')) fail('--product must be a project-owned artifact');

// This rung reads no real data, and the generator refuses to produce one that
// could. The real database is not merely "not passed" -- it is unnameable here.
for (const [value, label] of [[fixture, '--fixture'], [home, '--home'], [cwd, '--cwd'], [tmp, '--tmp']]) {
  if (/Library\/Messages/.test(value)) fail(`${label} names the real Messages directory`);
  if (/Library\/Application Support\/AddressBook/.test(value)) fail(`${label} names the real address book`);
}
// The fixture and the decoy container must both live under the run root, so the
// decoy the product is invited to find is one this script created.
if (!fixture.startsWith(`${home}/`)) fail('--fixture must live under --home, the private run root');

const templatePath = resolve(dirname(new URL(import.meta.url).pathname), `step3-${pass}.sh.template`);
const script = readFileSync(templatePath, 'utf8')
  .replaceAll('@@PRODUCT@@', product)
  .replaceAll('@@RUNHOME@@', home)
  .replaceAll('@@RUNTMP@@', tmp)
  .replaceAll('@@RUNCWD@@', cwd)
  .replaceAll('@@FIXTURE@@', fixture)
  .replaceAll('@@CONTACTS_FLAG@@', CONTACTS_FLAG)
  .replaceAll('@@SOURCE_LABEL@@', contactsSource ?? '')
  .replaceAll('@@ROLE@@', role);

if (script.includes('@@')) fail('an unsubstituted marker remains');

const codeOnly = script
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .replace(/\\\n\s*/g, ' ');

const FORBIDDEN = [
  [/\blaunchctl\b|\btailscale\b|\bbrew\b|\bsudo\b|\bcurl\b|\bssh\b/, 'a forbidden tool'],
  [/\bkill\b|\bkillall\b|\bpkill\b/, 'signalling'],
  [/2>\s*\/dev\/null/, 'discarded stderr'],
  [/[<>]\(/, 'process substitution'],
  [/&\s*$/m, 'a backgrounded command'],
  // The whole point of the rung is a decoy. Naming the real one would defeat it.
  [/Library\/Messages/, 'the real Messages directory'],
];
for (const [pattern, label] of FORBIDDEN) {
  if (pattern.test(codeOnly)) fail(`generated script contains ${label}`);
}

const ALLOWED = new Set([
  'echo', 'date', 'stat', 'shasum', 'ls', 'ps', 'log', 'mkdir', 'touch',
  'test', '[', 'set', 'export', 'exit', 'cat',
]);
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', '!']);
const WRITE_COMMANDS = new Set(['mkdir', 'touch']);
// Writes name the run root and nothing else. `${DECOY}` is built from
// `${RUNHOME}` inside the template, which the segmenter cannot see through, so
// it is listed explicitly and the template's assignment of it is checked below.
const WRITE_ROOTS = ['"${RUNHOME}', '"${DECOY}', '"${RUNTMP}'];

if (pass === 'decoy'
  && !/^DECOY="\$\{RUNHOME\}\/Library\/Containers\/com\.apple\.MobileSMS\/Data"$/m.test(codeOnly)) {
  fail('DECOY must be assigned exactly the run-root container path');
}

const HEREDOC = /<<'REQUEST'\n[\s\S]*?\nREQUEST\n/g;
const RUN_SHAPE = new RegExp(
  '^/usr/bin/env -i HOME="\\$\\{RUNHOME\\}" PATH=/usr/bin:/bin:/usr/sbin:/sbin '
  + 'TMPDIR="\\$\\{RUNTMP\\}" LANG=en_US\\.UTF-8 LC_ALL=en_US\\.UTF-8 '
  + '"\\$\\{PRODUCT\\}" rpc --db "\\$\\{FIXTURE\\}"'
  + CONTACTS_FLAG.replace(/-/g, '\\-')
  + ' <<\'REQUEST\'$'
);

let runs = 0;
for (const rawLine of codeOnly.replace(HEREDOC, "<<'REQUEST'\n").split('\n')) {
  const line = rawLine.trim();
  if (!line) continue;
  for (const rawSegment of line.split(/\|\||&&|[;|]|(?<!>)&/)) {
    let segment = rawSegment.trim();
    if (/^PATH=/.test(segment) && segment !== 'PATH=/usr/bin:/bin:/usr/sbin:/sbin') {
      fail(`PATH reassigned to an unapproved value: ${segment}`);
    }
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

    if (WRITE_COMMANDS.has(bare)) {
      const targets = segment.split(/\s+/).slice(1).filter(a => !a.startsWith('-'));
      if (targets.length === 0) fail(`write with no target: ${segment}`);
      for (const target of targets) {
        if (!WRITE_ROOTS.some(r => target.startsWith(r))) fail(`write outside the run root: ${segment}`);
      }
    }
  }
}
if (runs !== 1) fail(`expected exactly one execution, found ${runs}`);

for (const match of codeOnly.matchAll(/(^|[^-&>])([0-9]?)>>?\s*([^\s&][^\s]*)/gm)) {
  const target = match[3];
  if (!WRITE_ROOTS.some(r => target.startsWith(r)) && target !== '/dev/null') {
    fail(`redirection outside the run root: ${target}`);
  }
}

const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}

writeFileSync(outPath, script, { mode: 0o600 });
console.log(`wrote ${outPath.split('/').pop()}`);
console.log(`pass=${pass}${contactsSource ? `/${contactsSource}` : ''} role=${role} executions=${runs} bytes=${script.length}`);
