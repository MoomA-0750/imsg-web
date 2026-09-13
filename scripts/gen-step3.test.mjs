// The step3 generator is the first that both writes and executes. Its refusals
// are what keep that combination from becoming "runs the product against the
// owner's data", so each refusal is exercised against a broken copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(here, 'gen-step3.mjs');
const TEMPLATE = join(here, 'step3-decoy.sh.template');

const HOME = '/Users/example/Library/Application Support/imsg-web/step3-run';
const BASE = {
  pass: 'decoy',
  role: 'm1',
  product: '/Users/example/Library/Application Support/imsg-web/phase-d/candidate/.build/release/imsg',
  home: HOME,
  tmp: `${HOME}/tmp`,
  cwd: HOME,
  fixture: `${HOME}/fixture.db`,
};

function run(overrides = {}, extraLine = null) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-step3-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-step3.mjs'));
    const template = readFileSync(TEMPLATE, 'utf8');
    writeFileSync(join(dir, 'step3-decoy.sh.template'),
      extraLine === null ? template : `${template}\n${extraLine}\n`);
    const options = { ...BASE, ...overrides, out: join(dir, 'out.sh') };
    const argv = Object.entries(options).flatMap(([k, v]) => [`--${k}`, v]);
    try {
      return { ok: true, output: execFileSync(process.execPath, [join(dir, 'gen-step3.mjs'), ...argv], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }) };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the unmodified template generates exactly one execution', () => {
  const result = run();
  assert.equal(result.ok, true, `control generation failed: ${result.output}`);
  assert.match(result.output, /executions=1/);
});

// Refusals driven by the arguments.
const ARGUMENT_REFUSALS = [
  ['the real Messages database as the fixture',
    { fixture: '/Users/example/Library/Messages/chat.db' }, 'names the real Messages directory'],
  ['a home that is the real Messages directory',
    { home: '/Users/example/Library/Messages' }, 'names the real Messages directory'],
  ['the real address book',
    { fixture: '/Users/example/Library/Application Support/AddressBook/x.db' }, 'names the real address book'],
  ['a fixture outside the run root',
    { fixture: '/tmp/elsewhere/fixture.db' }, 'must live under --home'],
  ['the intel role, which this rung exists to decide about',
    { role: 'intel' }, '--role must be m1'],
  ['a pass that does not exist', { pass: 'parity' }, '--pass must be decoy'],
  ['a product that is not project-owned',
    { product: '/usr/local/bin/imsg' }, 'must be a project-owned artifact'],
  ['a cwd inside a build tree',
    { cwd: `${HOME}/.build/release` }, 'must not be inside a build tree'],
  ['a relative path', { fixture: 'fixture.db' }, 'must be an absolute path'],
  ['a path escaping through ..', { fixture: `${HOME}/../../etc/passwd` }, 'must not contain ..'],
];

for (const [name, overrides, expected] of ARGUMENT_REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = run(overrides);
    assert.equal(result.ok, false, `expected refusal for ${JSON.stringify(overrides)}`);
    assert.match(result.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

// Refusals driven by an edited template.
const TEMPLATE_REFUSALS = [
  ['a second execution',
    '/usr/bin/env -i HOME="${RUNHOME}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${RUNTMP}" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "${PRODUCT}" rpc --db "${FIXTURE}" <<\'REQUEST\'\n{}\nREQUEST',
    'expected exactly one execution, found 2'],
  ['an execution that leaks the ambient environment',
    '"${PRODUCT}" rpc --db "${FIXTURE}"', 'command name comes from a variable'],
  ['an execution of a different shape',
    '/usr/bin/env -i HOME="${RUNHOME}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${RUNTMP}" LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "${PRODUCT}" watch', 'not the approved shape'],
  ['signalling', 'kill -TERM 123', 'signalling'],
  ['killall', 'killall imsg', 'signalling'],
  ['launchctl', 'launchctl bootout gui/501/xyz', 'a forbidden tool'],
  ['ssh to the other host', 'ssh im uptime', 'a forbidden tool'],
  ['naming the real Messages directory', 'ls "${HOME}/Library/Messages"', 'the real Messages directory'],
  ['a write outside the run root', 'mkdir /tmp/elsewhere', 'write outside the run root'],
  ['a second write target outside the run root',
    'touch "${RUNHOME}/ok" /tmp/elsewhere', 'write outside the run root'],
  ['a redirection outside the run root',
    'shasum -a 256 "${FIXTURE}" > /tmp/out.txt', 'redirection outside the run root'],
  ['deleting anything', 'rm -rf "${DECOY}"', 'command not on the allow-list'],
  ['copying the fixture out', 'cp "${FIXTURE}" /tmp/x', 'command not on the allow-list'],
  ['indirect execution through sh', 'sh -c id', 'command not on the allow-list'],
  ['discarded stderr', 'shasum -a 256 "${FIXTURE}" 2>/dev/null', 'discarded stderr'],
  ['process substitution', 'shasum -a 256 <(echo x)', 'process substitution'],
  ['a backgrounded command', 'shasum -a 256 "${FIXTURE}" &', 'a backgrounded command'],
  ['reassigning PATH', 'PATH=/tmp/evil:/usr/bin', 'PATH reassigned'],
  ['curl', 'curl https://example.invalid', 'a forbidden tool'],
];

for (const [name, line, expected] of TEMPLATE_REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = run({}, line);
    assert.equal(result.ok, false, `expected refusal for: ${line}`);
    assert.match(result.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

// The contacts pass. Its two arms must differ by exactly the flag, because the
// control arm is the only thing that tells a working flag from a broken one.
function runContacts(source, extraLine = null) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-step3-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-step3.mjs'));
    const template = readFileSync(join(here, 'step3-contacts.sh.template'), 'utf8');
    writeFileSync(join(dir, 'step3-contacts.sh.template'),
      extraLine === null ? template : `${template}\n${extraLine}\n`);
    const options = { ...BASE, pass: 'contacts', out: join(dir, 'out.sh') };
    if (source !== null) options['contacts-source'] = source;
    const argv = Object.entries(options).flatMap(([k, v]) => [`--${k}`, v]);
    try {
      execFileSync(process.execPath, [join(dir, 'gen-step3.mjs'), ...argv], { stdio: 'pipe' });
      return { ok: true, script: readFileSync(join(dir, 'out.sh'), 'utf8') };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the two contacts arms differ by exactly the flag', () => {
  const control = runContacts('auto');
  const treatment = runContacts('addressbook');
  assert.equal(control.ok, true);
  assert.equal(treatment.ok, true);
  const runLine = (s) => s.split('\n').find((l) => l.startsWith('/usr/bin/env'));
  assert.equal(
    runLine(control.script),
    runLine(treatment.script).replace(' --contacts-from-address-book', ''),
    'the arms differ by more than the flag');
});

test('refuses a contacts pass with no source, which would have no control', () => {
  const result = runContacts(null);
  assert.equal(result.ok, false);
  assert.match(result.output, /--contacts-source must be auto/);
});

test('refuses an unknown contacts source', () => {
  const result = runContacts('cloud');
  assert.equal(result.ok, false);
  assert.match(result.output, /--contacts-source must be auto/);
});

test('refuses a contacts arm whose run line carries the wrong flag', () => {
  const result = runContacts('auto',
    '/usr/bin/env -i HOME="${RUNHOME}" PATH=/usr/bin:/bin:/usr/sbin:/sbin TMPDIR="${RUNTMP}" '
    + 'LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 "${PRODUCT}" rpc --db "${FIXTURE}" '
    + "--contacts-from-address-book <<'REQUEST'\n{}\nREQUEST");
  assert.equal(result.ok, false);
  assert.match(result.output, /not the approved shape|exactly one execution/);
});

// The decoy is the whole experiment. If it could be pointed at the real
// container the rung would become the IPC exchange it exists to avoid.
test('refuses a decoy pointed at the real container', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-step3-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-step3.mjs'));
    const template = readFileSync(TEMPLATE, 'utf8').replace(
      'DECOY="${RUNHOME}/Library/Containers/com.apple.MobileSMS/Data"',
      'DECOY="${HOME}/Library/Containers/com.apple.MobileSMS/Data"');
    writeFileSync(join(dir, 'step3-decoy.sh.template'), template);
    const argv = Object.entries({ ...BASE, out: join(dir, 'out.sh') }).flatMap(([k, v]) => [`--${k}`, v]);
    assert.throws(() => execFileSync(process.execPath, [join(dir, 'gen-step3.mjs'), ...argv], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses writing the generated script into the repository', () => {
  const result = run({}, null);
  assert.equal(result.ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'gen-step3-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-step3.mjs'));
    copyFileSync(TEMPLATE, join(dir, 'step3-decoy.sh.template'));
    const argv = Object.entries({ ...BASE, out: '/home/x/imsg-web/out.sh' }).flatMap(([k, v]) => [`--${k}`, v]);
    assert.throws(() => execFileSync(process.execPath, [join(dir, 'gen-step3.mjs'), ...argv], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
