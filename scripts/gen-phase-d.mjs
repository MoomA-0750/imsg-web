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

// An allow-list, not a deny-list. The deny-list version passed
// `"${PRODUCT}" --version`: the word contains `$`, so the command name was
// blanked and every check skipped -- which would have executed the artifact
// this phase is forbidden to run. Anything not named here is refused.
const ALLOWED_COMMANDS = new Set([
  'echo', 'printf', 'date', 'stat', 'df', 'shasum', 'cut', 'grep', 'tar',
  'mkdir', 'touch', 'find', 'git', 'file', 'lipo', 'codesign', 'otool',
  'xcode-select', 'xcrun', 'sw_vers', 'uname', 'test', '[', 'cd', 'return',
  'exit', 'set', 'export',
]);

// Executed by absolute or explicit relative path, and only these two.
const ALLOWED_PATHS = new Set(['/usr/bin/swift', './scripts/patch-deps.sh']);

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done',
  'case', 'esac', 'for', 'in', '!', '{', '}', '(', ')', 'time',
]);

// Writes must name one of these. Deliberately narrower than the roots a read
// may start from: the earlier version shared one list, so `mkdir "${HOME}/x"`
// counted as confined.
const WRITE_ROOTS = ['"${ROOT}', '"${dir}'];
const READ_ROOTS = ['"${ROOT}', '"${dir}', '"${ARCHIVE}"', '"${outside}"', '"${PRODUCT}"', '"${HOME}'];
const WRITE_COMMANDS = new Set(['mkdir', 'touch', 'tar']);

const GIT_PREFIX = 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C ';
const GIT_ALLOWED = /^(rev-parse (HEAD|"HEAD\^\{tree\}")|status --porcelain)$/;

// swift is allowed three shapes only. `swift run` executes the product and
// `swift package clean|reset|purge-cache` deletes; both would have passed an
// unchecked `swift`.
const SWIFT_ALLOWED = /^\/usr\/bin\/swift (--version|package .*resolve|build .*-c release .*--force-resolved-versions)/;

function segments(code) {
  const found = [];
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // `(?<!>)&` so that `2>&1` is not split into `... 2>` and `1`, which made
    // the redirection's target look like a command named `1`.
    for (const rawSegment of line.split(/\|\||&&|[;|]|(?<!>)&/)) {
      let segment = rawSegment.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*=('[^']*'|"[^"]*"|\S*)$/.test(segment)) continue;
      // NAME=$(cmd ...): the assignment runs nothing and the substitution is
      // audited separately by inner(). Without this the leading word is
      // `NAME=$(cmd`, which contains `$` and is refused as an unknown command.
      if (/^[A-Za-z_][A-Za-z0-9_]*=(\$\(|`)/.test(segment)) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment) && !/\s/.test(segment.split('=')[0])) {
        const rest = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"))\s+(.*)$/);
        if (rest) segment = rest[1].trim();
      }
      // `for NAME in <list>` is a binding and a word list, not a command. The
      // loop body arrives as its own segment, so skipping this one audits the
      // body without treating the first list item as a command name.
      if (/^for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\b/.test(segment)) continue;
      if (/^case\s+\S+\s+in\b/.test(segment)) continue;
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
  let rest = code;
  for (let depth = 0; depth < 4; depth += 1) {
    const pattern = /\$\(([^()]*)\)|`([^`]*)`/g;
    const found = [];
    let match = pattern.exec(rest);
    while (match) { found.push(match[1] ?? match[2] ?? ''); match = pattern.exec(rest); }
    if (found.length === 0) break;
    out.push(...found);
    // Strip the innermost level so a nested substitution's outer command is
    // seen on the next pass rather than skipped.
    rest = rest.replace(/\$\([^()]*\)|`[^`]*`/g, ' X ');
  }
  return out;
}

// Shell functions defined by this same template. Collected rather than
// hardcoded, so a renamed function does not silently become an unknown command
// and a function defined elsewhere is still refused.
function definedFunctions(code) {
  const names = new Set();
  for (const match of code.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\)/gm)) {
    names.add(match[1]);
    names.add(`${match[1]}()`);
  }
  return names;
}

let LOCAL_FUNCTIONS = new Set();

function audit(code, origin) {
  for (const { word, text } of segments(code)) {
    const bare = word.replace(/^["']|["']$/g, '');

    // A command whose name comes from a variable cannot be checked, so it is
    // refused rather than skipped.
    if (bare.includes('$')) fail(`command name comes from a variable in ${origin}: ${text}`);

    if (bare.includes('/')) {
      if (!ALLOWED_PATHS.has(bare)) fail(`script or binary executed by path in ${origin}: ${bare}`);
      if (bare === '/usr/bin/swift' && !SWIFT_ALLOWED.test(text)) {
        fail(`swift invocation not allow-listed in ${origin}: ${text}`);
      }
      if (bare === '/usr/bin/swift') {
        for (const m of text.matchAll(/--(cache|config|security|scratch)-path\s+(\S+)/g)) {
          if (!WRITE_ROOTS.some(r => m[2].startsWith(r))) {
            fail(`swift ${m[1]}-path outside the build root in ${origin}: ${m[2]}`);
          }
        }
        for (const m of text.matchAll(/--([a-z-]*path)\s/g)) {
          if (!['cache-path', 'config-path', 'security-path', 'scratch-path'].includes(m[1])) {
            fail(`unrecognised swift path option in ${origin}: --${m[1]}`);
          }
        }
      }
      continue;
    }

    if (!ALLOWED_COMMANDS.has(bare) && !LOCAL_FUNCTIONS.has(bare)) fail(`command not on the allow-list in ${origin}: ${bare}`);

    if (bare === 'git') {
      if (!text.startsWith(GIT_PREFIX)) fail(`git is not the approved non-locking form in ${origin}`);
      const after = text.slice(GIT_PREFIX.length).replace(/^("[^"]*"|\S+)\s*/, '').trim();
      if (!GIT_ALLOWED.test(after)) fail(`git subcommand not allow-listed in ${origin}: ${after}`);
    }

    if (WRITE_COMMANDS.has(bare)) {
      if (bare === 'tar') {
        if (!/-C\s+"\$\{ROOT\}"/.test(text)) fail(`tar without -C into the build root in ${origin}: ${text}`);
        if (/\s-P\b/.test(text)) fail(`tar -P in ${origin}`);
      } else {
        const target = text.split(/\s+/).slice(1).find(a => !a.startsWith('-'));
        if (!target || !WRITE_ROOTS.some(r => target.startsWith(r))) {
          fail(`write outside the build root in ${origin}: ${text}`);
        }
      }
    }

    if (bare === 'find') {
      if (!/-maxdepth\s+\d/.test(text)) fail(`unbounded find in ${origin}: ${text}`);
      for (const banned of ['-delete', '-ok', '-okdir', '-execdir']) {
        if (text.includes(banned)) fail(`mutating find in ${origin}: ${banned}`);
      }
      const start = text.split(/\s+/)[1] ?? '';
      if (!READ_ROOTS.some(r => start.startsWith(r))) fail(`find outside approved roots in ${origin}: ${start}`);
      for (const chunk of text.split('-exec ').slice(1)) {
        const execCommand = (chunk.trim().split(/\s+/)[0] ?? '').split('/').pop();
        if (!['shasum', 'stat', 'ls', 'file'].includes(execCommand)) {
          fail(`find -exec running ${execCommand} in ${origin}`);
        }
      }
    }
  }

  // Redirections, including the fd-numbered forms the previous pattern excluded
  // in order to permit `2>&1`.
  for (const match of code.matchAll(/(^|[^-&>])([0-9]?)>>?\s*([^\s&][^\s]*)/gm)) {
    const target = match[3];
    if (!WRITE_ROOTS.some(r => target.startsWith(r)) && target !== '/dev/null') {
      fail(`redirection outside the build root in ${origin}: ${target}`);
    }
  }
}

LOCAL_FUNCTIONS = definedFunctions(codeOnly);
audit(codeOnly, 'the script body');
for (const block of inner(codeOnly)) audit(block, 'a command substitution');

const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}

writeFileSync(outPath, script, { mode: 0o600 });
console.log(`wrote ${outPath.split('/').pop()}`);
console.log(`role=${role} bytes=${script.length}`);
