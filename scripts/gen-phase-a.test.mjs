// The generator's refusals are the last line of defence between an edited
// template and a command running on the owner's Mac. A guard that has never
// been shown to fire is not a guard, so each refusal is exercised here against
// a deliberately broken copy of the real template.
//
// Every case below was a live gap at some point: the first review rejected
// `-exec sh -c`, and the generator did not stop it until this suite existed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(here, 'gen-phase-a.mjs');
const TEMPLATE = join(here, 'phase-a-pass1.sh.template');
const BASE = '/Users/example/Library/Application Support/imsg-web';

function generateWith(extraLine) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-a-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-a.mjs'));
    const template = readFileSync(TEMPLATE, 'utf8');
    writeFileSync(
      join(dir, 'phase-a-pass1.sh.template'),
      extraLine === null ? template : `${template}\n${extraLine}\n`,
    );
    try {
      const stdout = execFileSync(
        process.execPath,
        [join(dir, 'gen-phase-a.mjs'), '--pass', '1', '--role', 'm1',
         '--base', BASE, '--out', join(dir, 'out.sh')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return { ok: true, output: stdout };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the unmodified template generates', () => {
  const result = generateWith(null);
  assert.equal(result.ok, true, `control generation failed: ${result.output}`);
});

// Pass 2 is the template that actually uses git, so its own generation is the
// real control for the allow-list.
test('the pass 2 template generates, including its git invocations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-a-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-a.mjs'));
    copyFileSync(join(here, 'phase-a-pass2.sh.template'), join(dir, 'phase-a-pass2.sh.template'));
    const stdout = execFileSync(
      process.execPath,
      [join(dir, 'gen-phase-a.mjs'), '--pass', '2', '--role', 'intel',
       '--base', BASE, '--tmpd', '/private/tmp/example', '--out', join(dir, 'out.sh')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.match(stdout, /wrote out\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses an unsafe build-tree root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-a-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-a.mjs'));
    copyFileSync(join(here, 'phase-a-pass2.sh.template'), join(dir, 'phase-a-pass2.sh.template'));
    assert.throws(() => execFileSync(
      process.execPath,
      [join(dir, 'gen-phase-a.mjs'), '--pass', '2', '--role', 'intel',
       '--base', BASE, '--tmpd', '/private/tmp/$(whoami)', '--out', join(dir, 'out.sh')],
      { stdio: 'pipe' },
    ));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const REFUSALS = [
  ['node hidden in a command substitution', 'V="$(node --version)"', 'node'],
  ['imsg invoked directly', 'imsg chats list', 'imsg'],
  ['append redirection', 'ls -la /tmp >> /tmp/out.log', 'append redirection'],
  ['combined redirection', 'ls -la /tmp &> /tmp/out.log', 'combined redirection'],
  ['plain redirection', 'ls -la /tmp > /tmp/out.log', 'output redirection'],
  ['find -delete', 'find "${BASE}" -maxdepth 2 -name x -delete', '-delete'],
  ['find -exec sh -c', 'find "${BASE}" -maxdepth 2 -exec sh -c "echo {}" \\;', 'find -exec running sh'],
  ['find rooted at /', 'find / -maxdepth 4 -name Package.resolved -print', 'unapproved root'],
  ['find without a depth bound', 'find "${BASE}" -name Package.resolved -print', 'unbounded find'],
  ['launchctl bootout', 'launchctl bootout gui/501', 'launchctl verb'],
  ['launchctl setenv', 'launchctl setenv FOO bar', 'launchctl verb'],
  ['tailscale serve mutation', 'tailscale serve https:443 /', 'serve verb'],
  ['discarded stderr', 'ls -la /nope 2>/dev/null', 'discarded stderr'],
  ['sudo', 'sudo ls /var/db', 'sudo'],
  ['eval', 'eval "$CMD"', 'eval'],
  ['xargs', 'echo x | xargs rm', 'xargs'],
  // A line-based scan misses this: `\s` does not span a backslash-newline.
  ['a mutation hidden behind a line continuation', 'launchctl \\\n  bootout gui/501', 'launchctl verb'],
  // git is allow-listed to exact non-locking read-only forms, not forbidden:
  // pass 2 needs it, and plain `git status` writes .git/index.
  ['plain git status', 'git status --porcelain', 'not the approved non-locking form'],
  ['git without the fsmonitor override', 'git --no-optional-locks -C /t status --porcelain', 'not the approved non-locking form'],
  ['a non-allow-listed git subcommand', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C /t log --oneline', 'not allow-listed'],
  ['a writing git subcommand', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C /t checkout main', 'not allow-listed'],
  // rev-parse --parseopt reads its spec from stdin, which under /bin/sh -s is
  // the rest of the script.
  ['git rev-parse --parseopt', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C /t rev-parse --parseopt', 'not allow-listed'],
  ['git rev-parse with an unlisted option', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C /t rev-parse --show-toplevel', 'not allow-listed'],
  // A first-match check passes this: the second utility is not in command
  // position either, so nothing else would catch it.
  ['a second find -exec after an allowed one', 'find "${BASE}" -maxdepth 1 -exec stat {} + -exec sh -c "id" \\;', 'find -exec running sh'],
];

for (const [name, line, expected] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = generateWith(line);
    assert.equal(result.ok, false, `expected refusal, but generation succeeded for: ${line}`);
    assert.match(result.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('refuses a base path that is not absolute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-a-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-a.mjs'));
    copyFileSync(TEMPLATE, join(dir, 'phase-a-pass1.sh.template'));
    assert.throws(() => execFileSync(
      process.execPath,
      [join(dir, 'gen-phase-a.mjs'), '--pass', '1', '--role', 'm1',
       '--base', 'relative/path', '--out', join(dir, 'out.sh')],
      { stdio: 'pipe' },
    ));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses to write inside a git repository', () => {
  const result = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-phase-a-test-'));
    try {
      copyFileSync(GENERATOR, join(dir, 'gen-phase-a.mjs'));
      copyFileSync(TEMPLATE, join(dir, 'phase-a-pass1.sh.template'));
      try {
        execFileSync(
          process.execPath,
          [join(dir, 'gen-phase-a.mjs'), '--pass', '1', '--role', 'm1',
           '--base', BASE, '--out', '/home/x/imsg-web/generated.sh'],
          { encoding: 'utf8', stdio: 'pipe' },
        );
        return { ok: true, output: '' };
      } catch (error) {
        return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  assert.equal(result.ok, false);
  assert.match(result.output, /git repository/);
});
