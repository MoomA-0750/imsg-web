#!/usr/bin/env node
// Generate the Step2 Phase D build script.
//
// Separate from scripts/gen-phase-a.mjs on purpose. That generator refuses
// mkdir, chmod, tar, every redirection and every command that could write, and
// that refusal IS the read-only guarantee for Phases A, B and C8. Phase D
// writes, so relaxing that generator to let it through would retroactively
// weaken every probe it has produced and every probe it will produce. Two
// generators, two contracts, neither weakening the other.
//
// The Phase D contract: writes are allowed, but only under the build root.
//
// Usage:
//   node scripts/gen-phase-d.mjs --role intel|m1 --root /abs/build/root \
//        --archive /abs/archive.tgz --archive-sha <64 hex> --out /path/out.sh

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(message) {
  console.error(`gen-phase-d: ${message}`);
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
  if (!value.startsWith('/')) fail(`${label} must be an absolute path`);
  if (value.length > 512) fail(`${label} is implausibly long`);
  if (UNSAFE.test(value)) fail(`${label} contains a character that is unsafe to substitute`);
  if (value.endsWith('/')) fail(`${label} must not have a trailing slash`);
  if (value.includes('/..')) fail(`${label} must not contain ..`);
}

const args = parseArgs(process.argv.slice(2));
const { role, root, archive, out } = args;
const archiveSha = args['archive-sha'];

if (role !== 'intel' && role !== 'm1') fail('--role must be intel or m1');
for (const [value, label] of [[root, '--root'], [archive, '--archive'], [out, '--out']]) {
  if (!value) fail(`${label} is required`);
}
checkPath(root, '--root');
checkPath(archive, '--archive');
if (!/^[0-9a-f]{64}$/.test(archiveSha ?? '')) fail('--archive-sha must be 64 hex characters');

// The root must be the project's own directory, not somewhere arbitrary. This
// is the single thing that makes "writes are confined" checkable at all.
if (!root.includes('/imsg-web')) fail('--root must live under the project base directory');

const templatePath = resolve(dirname(new URL(import.meta.url).pathname), 'phase-d-build.sh.template');
const script = readFileSync(templatePath, 'utf8')
  .replaceAll('@@BUILDROOT@@', root)
  .replaceAll('@@ROLE@@', role)
  .replaceAll('@@ARCHIVE@@', archive)
  .replaceAll('@@ARCHIVE_SHA@@', archiveSha);

if (script.includes('@@')) fail('an unsubstituted marker remains in the generated script');

const codeOnly = script
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .replace(/\\\n\s*/g, ' ');

// Unambiguous wherever they appear.
const FORBIDDEN_PATTERNS = [
  [/\blaunchctl\b/, 'launchctl'],
  [/\btailscale\b/, 'tailscale'],
  [/\bserve\b/, 'serve'],
  [/2>\s*\/dev\/null/, 'discarded stderr'],
  [/--disable-sandbox/, 'SwiftPM sandbox disabled'],
  [/\bswift\s+test\b/, 'swift test'],
  [/--build-tests/, 'test targets built'],
];
for (const [pattern, label] of FORBIDDEN_PATTERNS) {
  if (pattern.test(codeOnly)) fail(`generated script contains a forbidden construct: ${label}`);
}

// Nothing is ever deleted, and nothing outside the root is modified. `rm` is
// absent entirely rather than restricted: this phase has no reason to remove
// anything, and AGENTS.md forbids clearing retained state automatically.
const FORBIDDEN_COMMANDS = new Set([
  'imsg', 'node', 'npm', 'npx', 'sudo', 'rm', 'rmdir', 'kill', 'killall',
  'chown', 'chflags', 'mv', 'ln', 'dd', 'mdfind', 'mdutil', 'osascript',
  'open', 'defaults', 'csrutil', 'tccutil', 'softwareupdate', 'installer',
  'brew', 'eval', 'exec', 'xargs', 'tee', 'nohup', 'caffeinate', 'curl', 'scp',
  'ssh', 'nc', 'ftp',
]);

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done',
  'case', 'esac', 'for', 'in', '!', '{', '}', '(', ')', 'time', 'return',
]);

// Writes are allowed, but each one must name a path under the root. A write
// whose destination the generator cannot see is not a confined write.
const WRITE_COMMANDS = new Set(['mkdir', 'touch', 'chmod', 'tar', 'cd']);

function segments(code) {
  const found = [];
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const rawSegment of line.split(/\|\||&&|[;|&]/)) {
      let segment = rawSegment.trim();
      // A pure assignment runs nothing. Anchored at the end on purpose: the
      // unanchored form let the `\S*` alternative backtrack into a quoted value
      // containing a space, so `BASE='/…/Application Support/…'` was parsed as a
      // command named `BASE='/…/Application`. It never matched a forbidden name,
      // so it failed silently -- the parser simply stopped seeing the real
      // command on any line whose assignment value had a space in it.
      if (/^[A-Za-z_][A-Za-z0-9_]*=('[^']*'|"[^"]*"|\S*)$/.test(segment)) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment) && !/\s/.test(segment.split('=')[0])) {
        const rest = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"))\s+(.*)$/);
        if (rest) segment = rest[1].trim();
      }
      for (let guard = 0; guard < 8; guard += 1) {
        const word = segment.split(/\s/)[0];
        if (word && SHELL_KEYWORDS.has(word)) { segment = segment.slice(word.length).trim(); continue; }
        break;
      }
      const word = segment.split(/\s/)[0];
      if (word) found.push({ word, text: segment });
    }
  }
  return found;
}

function inner(code) {
  const out = [];
  const pattern = /\$\(([^()]*)\)|`([^`]*)`/g;
  let match = pattern.exec(code);
  while (match) { out.push(match[1] ?? match[2] ?? ''); match = pattern.exec(code); }
  return out;
}

const ROOT_REFS = ['"${ROOT}', '"${dir}', '"${ARCHIVE}"', '"${outside}"', '"${PRODUCT}"', '"${HOME}'];
const GIT_PREFIX = 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C ';
const GIT_ALLOWED = /^(rev-parse (HEAD|"HEAD\^\{tree\}")|status --porcelain)$/;

function audit(code, origin) {
  for (const { word, text } of segments(code)) {
    const bare = word.replace(/^["']|["']$/g, '');
    const command = bare.includes('$') ? '' : bare.split('/').pop();

    if (command && FORBIDDEN_COMMANDS.has(command)) {
      fail(`forbidden command in ${origin}: ${command}`);
    }

    // Running a script by path is how upstream's patch-deps.sh gets applied,
    // and it is the one such invocation this phase makes. Left unrestricted,
    // the command allow-list above would be decorative: any path could be run.
    if (bare.includes('/') && !bare.startsWith('/usr/bin/') && !bare.startsWith('/bin/')) {
      if (bare !== './scripts/patch-deps.sh') {
        fail(`script executed by path in ${origin}, and it is not the approved one: ${bare}`);
      }
    }

    if (command === 'git') {
      if (!text.startsWith(GIT_PREFIX)) fail(`git is not the approved non-locking form in ${origin}`);
      const after = text.slice(GIT_PREFIX.length).replace(/^("[^"]*"|\S+)\s*/, '').trim();
      if (!GIT_ALLOWED.test(after)) fail(`git subcommand not allow-listed in ${origin}: ${after}`);
    }

    if (command && WRITE_COMMANDS.has(command)) {
      const target = text.split(/\s+/).slice(1).find(a => !a.startsWith('-'));
      if (!target || !ROOT_REFS.some(ref => target.startsWith(ref))) {
        fail(`write outside the build root in ${origin}: ${text}`);
      }
    }

    if (command === 'find') {
      if (!/-maxdepth\s+\d/.test(text)) fail(`unbounded find in ${origin}: ${text}`);
      for (const banned of ['-delete', '-ok', '-okdir', '-execdir']) {
        if (text.includes(banned)) fail(`mutating find in ${origin}: ${banned}`);
      }
      const start = text.split(/\s+/)[1] ?? '';
      if (!ROOT_REFS.some(ref => start.startsWith(ref))) fail(`find outside approved roots in ${origin}: ${start}`);
      for (const chunk of text.split('-exec ').slice(1)) {
        const execCommand = (chunk.trim().split(/\s+/)[0] ?? '').split('/').pop();
        if (!['shasum', 'stat', 'ls', 'file'].includes(execCommand)) {
          fail(`find -exec running ${execCommand} in ${origin}`);
        }
      }
    }
  }

  // Redirections are permitted only into the root.
  for (const match of code.matchAll(/(^|[^-&>0-9])>>?\s*(\S+)/gm)) {
    const target = match[2];
    if (!ROOT_REFS.some(ref => target.startsWith(ref)) && target !== '/dev/null') {
      fail(`redirection outside the build root in ${origin}: ${target}`);
    }
  }
}

audit(codeOnly, 'the script body');
for (const block of inner(codeOnly)) audit(block, 'a command substitution');

const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}

writeFileSync(outPath, script, { mode: 0o600 });
console.log(`wrote ${outPath.split('/').pop()}`);
console.log(`role=${role} bytes=${script.length}`);
