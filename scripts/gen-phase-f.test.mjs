// F1 is the first execution of a built product on the owner's machine. Its
// generator permits exactly one execution, in one shape, and no writes at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GEN = join(here, 'gen-phase-f.mjs');
const TPL = join(here, 'phase-f-f1.sh.template');
const BASE = '/Users/example/Library/Application Support/imsg-web';
const OPTS = ['--role', 'intel', '--product', `${BASE}/phase-d/baseline/.build/release/imsg`,
  '--home', '/Users/example', '--tmp', `${BASE}/phase-d/tmp`, '--cwd', `${BASE}/phase-d`];

function generateWith(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-f-test-'));
  try {
    copyFileSync(GEN, join(dir, 'gen-phase-f.mjs'));
    const tpl = readFileSync(TPL, 'utf8');
    writeFileSync(join(dir, 'phase-f-f1.sh.template'), extra === null ? tpl : `${tpl}\n${extra}\n`);
    try {
      const stdout = execFileSync(process.execPath, [join(dir, 'gen-phase-f.mjs'), ...OPTS, '--out', join(dir, 'o.sh')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, output: stdout };
    } catch (e) { return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the unmodified template generates, with exactly one execution', () => {
  const r = generateWith(null);
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /executions=1/);
});

const REFUSALS = [
  ['a second execution', '/usr/bin/env -i HOME="${RUNHOME}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${RUNTMP}" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "${PRODUCT}" --version < /dev/null', 'expected exactly one execution'],
  ['running the product directly', '"${PRODUCT}" --version', 'command name comes from a variable'],
  ['prefix assignments instead of env -i', 'HOME=x TMPDIR=y "${PRODUCT}" --version', 'command not on the allow-list: HOME=x'],
  ['env without -i', '/usr/bin/env HOME=x "${PRODUCT}" --version', 'not the approved shape'],
  ['a different subcommand', '/usr/bin/env -i HOME="${RUNHOME}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${RUNTMP}" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "${PRODUCT}" rpc < /dev/null', 'a rung beyond F1'],
  ['any write', 'mkdir /tmp/x', 'command not on the allow-list'],
  ['a redirection', 'echo hi > /tmp/x', 'any output redirection'],
  // The redirection check fires first; both refuse, and the earlier one is
  // the stricter statement (F1 writes nothing at all).
  ['discarded stderr', 'ls /nope 2>/dev/null', 'any output redirection'],
  ['sudo', 'sudo ls', 'forbidden tool'],
];
for (const [name, line, expected] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const r = generateWith(line);
    assert.equal(r.ok, false, `expected refusal for: ${line}`);
    assert.match(r.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('refuses a kill aimed at anything but the child it started', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-f-test-'));
  try {
    copyFileSync(GEN, join(dir, 'gen-phase-f.mjs'));
    const tpl = readFileSync(join(here, 'phase-f-f3.sh.template'), 'utf8');
    for (const bad of ['kill -TERM 57487', 'kill -9 "${CHILD}"', 'kill -TERM -"${CHILD}"', 'killall imsg']) {
      writeFileSync(join(dir, 'phase-f-f3.sh.template'), `${tpl}\n${bad}\n`);
      assert.throws(() => execFileSync(process.execPath, [
        join(dir, 'gen-phase-f.mjs'), '--pass', 'f3', ...OPTS.slice(0, 2),
        '--product', `${BASE}/phase-d/baseline/.build/release/imsg`,
        '--home', '/Users/example', '--tmp', `${BASE}/phase-d/tmp`, '--cwd', `${BASE}/phase-d`,
        '--fixture', `${BASE}/phase-d/f.db`, '--out', join(dir, 'o.sh'),
      ], { stdio: 'pipe' }), undefined, `should have refused: ${bad}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refuses a cwd inside a build tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-f-test-'));
  try {
    copyFileSync(GEN, join(dir, 'gen-phase-f.mjs'));
    copyFileSync(TPL, join(dir, 'phase-f-f1.sh.template'));
    const bad = OPTS.map(v => v === `${BASE}/phase-d` ? `${BASE}/phase-d/baseline/.build/release` : v);
    assert.throws(() => execFileSync(process.execPath, [join(dir, 'gen-phase-f.mjs'), ...bad, '--out', join(dir, 'o.sh')], { stdio: 'pipe' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
