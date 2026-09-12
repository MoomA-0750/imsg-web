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

function checkBase(base) {
  if (!base.startsWith('/')) fail('--base must be an absolute path');
  if (base.length > 512) fail('--base is implausibly long');
  if (FORBIDDEN.test(base)) fail('--base contains a character that is unsafe to substitute');
  if (base.endsWith('/') && base !== '/') fail('--base must not have a trailing slash');
  if (base === '/') fail('--base must not be the filesystem root');
  if (base.includes('/..')) fail('--base must not contain ..');
}

const args = parseArgs(process.argv.slice(2));
const pass = args.pass ?? '1';
const role = args.role;
const base = args.base;
const out = args.out;

if (pass !== '1') fail('only pass 1 has a template; pass 2 is built from pass 1 output');
if (role !== 'intel' && role !== 'm1') fail('--role must be intel or m1');
if (!base) fail('--base is required');
if (!out) fail('--out is required');
checkBase(base);

const templatePath = resolve(dirname(new URL(import.meta.url).pathname), 'phase-a-pass1.sh.template');
const template = readFileSync(templatePath, 'utf8');

const script = template.replaceAll('@@BASE@@', base).replaceAll('@@ROLE@@', role);

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
const codeOnly = script
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

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
  'softwareupdate', 'installer', 'brew', 'git',
  // Indirect execution: each of these can run anything, so allowing them would
  // make every entry above decorative. `-exec sh -c` was rejected during the
  // first review; without `sh` here, the generator would not have stopped it.
  'eval', 'exec', 'sh', 'bash', 'zsh', 'dash', 'env', 'xargs', 'tee',
  'nohup', 'caffeinate', 'script', 'perl', 'python', 'python3', 'ruby',
]);

// `find` can execute and delete. `-exec` is needed for the symlink listing, so
// it is allowed only with a read-only command and only in the `+` / `\;` forms.
const FIND_EXEC_ALLOWED = new Set(['ls', 'stat', 'file', 'shasum']);

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
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(segment) && !/\s/.test(segment.split('=')[0])) {
        const rest = segment.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*))\s+(.*)$/);
        if (!rest) continue;
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
      if (!start.startsWith('"${BASE}') && !start.startsWith('/private/tmp')) {
        fail(`generated script searches an unapproved root in ${origin}: ${start}`);
      }
      const execAt = text.indexOf('-exec ');
      if (execAt !== -1) {
        const execCommand = text.slice(execAt + 6).trim().split(/\s+/)[0] ?? '';
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
