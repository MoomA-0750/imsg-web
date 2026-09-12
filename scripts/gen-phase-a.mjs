#!/usr/bin/env node
// Generate a Step2 Phase A script from its template by substituting literal
// values, so nothing depends on the remote shell's environment.
//
// The remote side is a non-interactive /bin/sh reading the script on stdin. It
// does not source the login profile, so a variable like $BASE would expand to
// the empty string there and turn existing directories into false "not found"
// records. Substituting locally removes that failure entirely.
//
// Usage:
//   node scripts/gen-phase-a.mjs --pass 1 --role intel|m1 \
//        --base '/absolute/path' --out /path/to/generated.sh
//
// The generated file contains private absolute paths. Write it outside this
// repository and never commit it.

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(message) {
  console.error(`gen-phase-a: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--')) fail(`expected an option, got ${key}`);
    if (value === undefined) fail(`option ${key} has no value`);
    args[key.slice(2)] = value;
  }
  return args;
}

// A substituted path is pasted into single quotes in the generated script. Any
// of these characters could end the quoting, start a substitution, or split the
// argument, so the generator refuses rather than trying to escape them.
const FORBIDDEN = /['"`$;\\\n\r&|<>()*?[\]{}!#]/;

function checkBase(base, label = '--base') {
  if (!base.startsWith('/')) fail(`${label} must be an absolute path`);
  if (base.length > 512) fail(`${label} is implausibly long`);
  if (FORBIDDEN.test(base)) fail(`${label} contains a character that is unsafe to substitute`);
  if (base.endsWith('/') && base !== '/') fail(`${label} must not have a trailing slash`);
  if (base === '/') fail(`${label} must not be the filesystem root`);
  if (base.includes('/..')) fail(`${label} must not contain ..`);
}

const args = parseArgs(process.argv.slice(2));
const pass = args.pass ?? '1';
const tmpd = args.tmpd;
const role = args.role;
const base = args.base;
const out = args.out;

const TEMPLATES = new Map([
  ['1', 'phase-a-pass1.sh.template'],
  ['1b', 'phase-a-pass1b.sh.template'],
  ['2', 'phase-a-pass2.sh.template'],
  ['c8', 'phase-c-c8.sh.template'],
]);
if (!TEMPLATES.has(pass)) fail('--pass must be 1, 1b, 2 or c8');
if (role !== 'intel' && role !== 'm1') fail('--role must be intel or m1');
if (!base) fail('--base is required');
if (!out) fail('--out is required');
checkBase(base);
// The build-tree root is substituted the same way and gets the same scrutiny.
// 'NONE' is the explicit "this host has no such tree" value.
// Required for pass 2, and "this host has no such tree" must be written out as
// --tmpd NONE. Defaulting it silently would let a forgotten flag produce a
// clean run that skipped the whole point of the pass.
if (pass === '2') {
  if (!tmpd) fail('--pass 2 requires --tmpd (use NONE when the host has no build tree)');
  if (tmpd !== 'NONE') checkBase(tmpd, '--tmpd');
}

const templatePath = resolve(dirname(new URL(import.meta.url).pathname), TEMPLATES.get(pass));
const template = readFileSync(templatePath, 'utf8');

const script = template
  .replaceAll('@@BASE@@', base)
  .replaceAll('@@TMPD@@', tmpd ?? 'NONE')
  .replaceAll('@@ROLE@@', role);

// A surviving marker would hit `set -u` remotely, but catching it here is
// cheaper and unambiguous.
if (script.includes('@@')) fail('an unsubstituted marker remains in the generated script');

// The generated script must not reach out beyond what the reviewed template
// declares. These assertions are cheap and catch a bad edit to the template.
//
// Checked against code only: the template documents its own prohibitions in
// comments ("no sudo", "no 2>/dev/null anywhere"), and a naive substring scan
// matches that prose instead of a real command. Word boundaries matter too --
// "confirm " contains "rm ".
//
// Line continuations are joined first. A line-based scan treats each physical
// line as its own command, which both invents false positives (a continuation
// line beginning with a path that ends in `imsg` looks like an imsg
// invocation) and misses real ones: `launchctl \` + newline + `bootout` does
// not match `launchctl\s+bootout`, because `\s` does not span the backslash.
const codeOnly = script
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')
  .replace(/\\\n\s*/g, ' ');

// Patterns that are unambiguous wherever they appear in code.
//
// launchctl and tailscale are allow-listed rather than deny-listed: a deny list
// has to enumerate `start`, `stop`, `kill`, `setenv`, `submit`, `attach`,
// `debug`, ... and silently permits whatever it forgets. Only the read-only
// verbs this plan actually uses are accepted.
const FORBIDDEN_PATTERNS = [
  [/launchctl\s+(?!list\b|print\b)\S/, 'launchctl verb that is not list/print'],
  [/\bserve\s+(?!status\b)\S/, 'tailscale serve verb that is not status'],
  [/\bfunnel\b/, 'funnel'],
  [/2>\s*\/dev\/null/, 'discarded stderr'],
  // A real redirect writes. `"%N -> %Y"` in a stat format string does not, so
  // a `>` preceded by `-` is not a redirect. `>>` and `&>` must be matched
  // explicitly: in the single-`>` pattern below, `>>` slips through because the
  // first `>` is excluded by the lookahead and the second by the prefix class.
  [/>>/, 'append redirection'],
  [/&>/, 'combined redirection'],
  [/(^|[^-&>])>(?![&>])/m, 'output redirection'],
];

for (const [pattern, label] of FORBIDDEN_PATTERNS) {
  if (pattern.test(codeOnly)) fail(`generated script contains a forbidden construct: ${label}`);
}

// Executable names must be checked in command position, not as substrings.
// `type -a imsg` at end of line, `-name 'node'`, `echo "imsg not on PATH"` and
// the literal base path ".../imsg-web" are all legitimate; a substring scan
// rejects every one of them.
const FORBIDDEN_COMMANDS = new Set([
  'imsg', 'node', 'npm', 'npx', 'sudo', 'rm', 'rmdir', 'kill', 'killall',
  'chmod', 'chown', 'chflags', 'mv', 'cp', 'mkdir', 'touch', 'ln', 'dd',
  'mdfind', 'mdutil', 'osascript', 'open', 'defaults', 'csrutil', 'tccutil',
  'softwareupdate', 'installer', 'brew',
  // 'git' is deliberately NOT here: it is handled by checkGit below, which is
  // an allow-list of exact non-locking read-only forms. Listing it here as well
  // would reject it before that check ever ran.
  // Indirect execution: each of these can run anything, so allowing them would
  // make every entry above decorative. `-exec sh -c` was rejected during the
  // first review; without `sh` here, the generator would not have stopped it.
  'eval', 'exec', 'sh', 'bash', 'zsh', 'dash', 'env', 'xargs', 'tee',
  'nohup', 'caffeinate', 'script', 'perl', 'python', 'python3', 'ruby',
]);

// `git` is not forbidden outright, because pass 2 needs it, but plain
// `git status` writes .git/index and can spawn a resident fsmonitor daemon.
// Only these exact non-locking read-only forms are accepted, spelled out in
// full on one line so this check sees them -- assigning the prefix to a shell
// variable would hide the command behind a `$` and skip the check entirely.
const GIT_PREFIX =
  'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C ';
// Exact forms only. An open-ended `rev-parse` would admit `--parseopt`, which
// reads its specification from stdin -- and under `/bin/sh -s` stdin is the
// rest of this script, so it would silently swallow the remaining commands.
const GIT_ALLOWED_SUBCOMMANDS =
  /^(rev-parse (--absolute-git-dir|HEAD|"HEAD\^\{tree\}")|status --porcelain)$/;

function checkGit(text, origin) {
  if (!text.startsWith(GIT_PREFIX)) {
    fail(`git invocation in ${origin} is not the approved non-locking form: ${text}`);
  }
  const afterPath = text.slice(GIT_PREFIX.length).replace(/^("[^"]*"|\S+)\s*/, '').trim();
  if (!GIT_ALLOWED_SUBCOMMANDS.test(afterPath)) {
    fail(`git subcommand in ${origin} is not allow-listed: ${afterPath}`);
  }
}

// `find` can execute and delete. `-exec` is needed for the symlink listing, so
// it is allowed only with a read-only command and only in the `+` / `\;` forms.
const FIND_EXEC_ALLOWED = new Set(['ls', 'stat', 'file', 'shasum', 'cat']);

// Roots a bounded search may start from. `-maxdepth 4` on the wrong tree is
// still a scan of the wrong tree, so the root is checked as well as the depth.
const ALLOWED_FIND_ROOTS = [
  // BASE and TMPD are substituted literals that this generator validated with
  // checkBase, so a root written against them is checkable. A loop variable is
  // not: the generator cannot know what it holds, so templates unroll loops
  // that contain a find rather than hiding the root behind one.
  '"${BASE}',
  '"${TMPD}',
  '/private/tmp',
  '"${HOME}/Library/LaunchAgents"',
];

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done',
  'case', 'esac', 'for', 'in', '!', '{', '}', '(', ')', 'time',
]);

// A command substitution is command position too. Scanning only the outer text
// lets `V="$(node --version)"` through, because the segment's first word starts
// with `$` and is skipped -- which would defeat the single most important rule
// in this phase, that neither imsg nor node is executed.
function expandSubstitutions(code) {
  const inner = [];
  const pattern = /\$\(([^()]*)\)|`([^`]*)`/g;
  let match = pattern.exec(code);
  while (match) {
    inner.push(match[1] ?? match[2] ?? '');
    match = pattern.exec(code);
  }
  return inner;
}

function commandSegments(code) {
  const segments = [];
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const rawSegment of line.split(/\|\||&&|[;|&]/)) {
      let segment = rawSegment.trim();

      // A segment that is only an assignment runs nothing.
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
        const stripped = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*))\s+(.*)$/);
        if (stripped) {
          segment = stripped[1].trim();
          continue;
        }
        const word = segment.split(/\s/)[0];
        if (word && SHELL_KEYWORDS.has(word)) {
          segment = segment.slice(word.length).trim();
          continue;
        }
        break;
      }
      const word = segment.split(/\s/)[0];
      if (word) segments.push({ word, text: segment });
    }
  }
  return segments;
}

function auditCode(code, origin) {
  for (const { word, text } of commandSegments(code)) {
    const bare = word.replace(/^["']|["']$/g, '');
    const command = bare.includes('$') ? '' : bare.split('/').pop();

    if (command && FORBIDDEN_COMMANDS.has(command)) {
      fail(`generated script runs a forbidden command in ${origin}: ${command}`);
    }

    if (command === 'git') checkGit(text, origin);

    // Checked in command position, so `echo "find tree exit: $?"` is not a find.
    if (command === 'find') {
      if (!/-maxdepth\s+\d/.test(text)) {
        fail(`generated script has an unbounded find in ${origin}: ${text}`);
      }
      for (const banned of ['-delete', '-ok', '-okdir', '-execdir']) {
        if (text.includes(banned)) {
          fail(`generated script has a mutating find in ${origin}: ${banned}`);
        }
      }
      // `-maxdepth 4` on the wrong root is still a scan of the wrong tree.
      const start = text.split(/\s+/)[1] ?? '';
      if (!ALLOWED_FIND_ROOTS.some((root) => start.startsWith(root))) {
        fail(`generated script searches an unapproved root in ${origin}: ${start}`);
      }
      // Every occurrence: `-exec stat {} + -exec sh -c '...' \;` passes a
      // first-match check, and the second utility is not in command position
      // so the forbidden-command scan never sees it either.
      for (const chunk of text.split('-exec ').slice(1)) {
        const execCommand = chunk.trim().split(/\s+/)[0] ?? '';
        if (!FIND_EXEC_ALLOWED.has(execCommand.split('/').pop())) {
          fail(`generated script has a find -exec running ${execCommand} in ${origin}`);
        }
      }
    }
  }
}

auditCode(codeOnly, 'the script body');
for (const inner of expandSubstitutions(codeOnly)) {
  auditCode(inner, 'a command substitution');
}


const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}

writeFileSync(outPath, script, { mode: 0o600 });
chmodSync(outPath, 0o600);

// Only the file name: the directory is private and there is no reason to put it
// into a transcript.
console.log(`wrote ${outPath.split('/').pop()}`);
console.log(`role=${role} pass=${pass} bytes=${script.length}`);
