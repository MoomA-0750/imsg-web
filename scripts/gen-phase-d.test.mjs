// Phase D writes to the owner's machines. Its generator's refusals are the only
// thing standing between an edited template and a command that escapes the
// build root, so each refusal is exercised against a deliberately broken copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(here, 'gen-phase-d.mjs');
const TEMPLATE = join(here, 'phase-d-build.sh.template');
const ROOT = '/Users/example/Library/Application Support/imsg-web/phase-d';
const SHA = '0'.repeat(64);

function generateWith(extraLine) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-d-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-d.mjs'));
    const template = readFileSync(TEMPLATE, 'utf8');
    writeFileSync(join(dir, 'phase-d-build.sh.template'),
      extraLine === null ? template : `${template}\n${extraLine}\n`);
    try {
      const stdout = execFileSync(process.execPath, [
        join(dir, 'gen-phase-d.mjs'), '--role', 'intel', '--root', ROOT,
        '--archive', `${ROOT}/src.tgz`, '--archive-sha', SHA, '--out', join(dir, 'out.sh'),
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

const REFUSALS = [
  ['deleting anything', 'rm -rf "${ROOT}/old"', 'rm'],
  ['sudo', 'sudo chown root "${ROOT}"', 'sudo'],
  ['launchctl', 'launchctl list', 'launchctl'],
  ['executing imsg', '"${dir}/.build/release/imsg" rpc', 'script executed by path'],
  ['executing node', 'node -e "1"', 'node'],
  ['swift test', 'swift test', 'swift test'],
  ['disabling the SwiftPM sandbox', 'swift build --disable-sandbox', 'sandbox disabled'],
  ['writing outside the root', 'mkdir -p /tmp/elsewhere', 'write outside the build root'],
  ['redirecting outside the root', 'shasum -a 256 "${ROOT}/x" > /tmp/out.txt', 'redirection outside the build root'],
  ['appending outside the root', 'echo x >> /tmp/out.txt', 'redirection outside the build root'],
  ['an unapproved script by path', './scripts/evil.sh', 'not the approved one'],
  ['find outside approved roots', 'find /Users -maxdepth 2 -print', 'find outside approved roots'],
  ['unbounded find', 'find "${ROOT}" -name x -print', 'unbounded find'],
  ['mutating find', 'find "${ROOT}" -maxdepth 2 -name x -delete', 'mutating find'],
  ['a non-allow-listed git subcommand', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C "${ROOT}" checkout main', 'not allow-listed'],
  ['discarded stderr', 'shasum -a 256 "${ROOT}/x" 2>/dev/null', 'discarded stderr'],
  ['curl', 'curl -o "${ROOT}/x" https://example.invalid', 'curl'],
];

for (const [name, line, expected] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = generateWith(line);
    assert.equal(result.ok, false, `expected refusal for: ${line}`);
    assert.match(result.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('refuses a build root outside the project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-d-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-d.mjs'));
    copyFileSync(TEMPLATE, join(dir, 'phase-d-build.sh.template'));
    assert.throws(() => execFileSync(process.execPath, [
      join(dir, 'gen-phase-d.mjs'), '--role', 'intel', '--root', '/tmp/anywhere',
      '--archive', '/tmp/anywhere/src.tgz', '--archive-sha', SHA, '--out', join(dir, 'out.sh'),
    ], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a malformed archive digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-d-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-d.mjs'));
    copyFileSync(TEMPLATE, join(dir, 'phase-d-build.sh.template'));
    assert.throws(() => execFileSync(process.execPath, [
      join(dir, 'gen-phase-d.mjs'), '--role', 'intel', '--root', ROOT,
      '--archive', `${ROOT}/src.tgz`, '--archive-sha', 'nothex', '--out', join(dir, 'out.sh'),
    ], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
