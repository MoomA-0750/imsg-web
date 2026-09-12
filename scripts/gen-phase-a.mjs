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
const FORBIDDEN_PATTERNS = [
  [/launchctl\s+(load|unload|bootout|bootstrap|kickstart|remove|enable|disable)\b/, 'launchctl mutation'],
  [/2>\s*\/dev\/null/, 'discarded stderr'],
  [/\bserve\s+(set|reset|clear)\b/, 'serve mutation'],
  [/\bfunnel\b/, 'funnel'],
  // A real redirect writes. `"%N -> %Y"` in a stat format string does not, so
  // a `>` preceded by `-` is not a redirect.
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
]);

const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done',
  'case', 'esac', 'for', 'in', '!', '{', '}', '(', ')', 'time',
]);

function commandSegments(code) {
  const segments = [];
  for (const rawLine of code.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const rawSegment of line.split(/\|\||&&|[;|&]/)) {
      let segment = rawSegment.trim();
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

for (const { word, text } of commandSegments(codeOnly)) {
  const bare = word.replace(/^["']|["']$/g, '');
  const command = bare.includes('$') ? '' : bare.split('/').pop();

  if (command && FORBIDDEN_COMMANDS.has(command)) {
    fail(`generated script runs a forbidden command: ${command}`);
  }

  // Checked in command position, so `echo "find tree exit: $?"` is not a find.
  if (command === 'find' && !/-maxdepth\s+\d/.test(text)) {
    fail(`generated script has an unbounded find: ${text}`);
  }
}


const outPath = resolve(out);
if (outPath.includes('/imsg-web/') || outPath.includes('/Obsidian-Vault/')) {
  fail('refusing to write a script with private paths inside a git repository');
}

writeFileSync(outPath, script, { mode: 0o600 });
chmodSync(outPath, 0o600);

console.log(`wrote ${outPath}`);
console.log(`role=${role} pass=${pass} bytes=${script.length}`);
