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
  ['executing imsg', '"${dir}/.build/release/imsg" rpc', 'command name comes from a variable'],
  ['executing node', 'node -e "1"', 'node'],
  ['swift test', 'swift test', 'swift test'],
  ['disabling the SwiftPM sandbox', 'swift build --disable-sandbox', 'sandbox disabled'],
  ['writing outside the root', 'mkdir -p /tmp/elsewhere', 'write outside the build root'],
  ['redirecting outside the root', 'shasum -a 256 "${ROOT}/x" > /tmp/out.txt', 'redirection outside the build root'],
  ['appending outside the root', 'echo x >> /tmp/out.txt', 'redirection outside the build root'],
  ['an unapproved script by path', './scripts/evil.sh', 'executed by path'],
  ['find outside approved roots', 'find /Users -maxdepth 2 -print', 'find outside approved roots'],
  ['unbounded find', 'find "${ROOT}" -name x -print', 'unbounded find'],
  ['mutating find', 'find "${ROOT}" -maxdepth 2 -name x -delete', 'mutating find'],
  ['a non-allow-listed git subcommand', 'git --no-optional-locks -c core.fsmonitor=false -c core.untrackedCache=false -C "${ROOT}" checkout main', 'not allow-listed'],
  ['discarded stderr', 'shasum -a 256 "${ROOT}/x" 2>/dev/null', 'discarded stderr'],
  ['curl', 'curl -o "${ROOT}/x" https://example.invalid', 'curl'],
  // Every one of these passed the earlier deny-list version.
  ['executing the product through a variable', '"${PRODUCT}" --version', 'command name comes from a variable'],
  ['writing into HOME', 'mkdir "${HOME}/.swiftpm"', 'write outside the build root'],
  ['extracting outside the root', 'tar -xzf "${ARCHIVE}" -C /', 'tar without -C into the build root'],
  ['tar with absolute paths permitted', 'tar -P -xzf "${ARCHIVE}" -C "${ROOT}"', 'tar -P'],
  ['an fd-numbered redirection outside the root', 'shasum -a 256 "${ROOT}/x" 1>/tmp/out', 'redirection outside the build root'],
  ['swift run, which executes the product', '/usr/bin/swift run imsg', 'swift invocation not allow-listed'],
  ['swift package clean, which deletes', '/usr/bin/swift package clean', 'swift invocation not allow-listed'],
  ['a swift path option outside the root', '/usr/bin/swift build --cache-path "${HOME}/c" -c release --force-resolved-versions', 'cache-path outside the build root'],
  ['indirect execution through sh', 'sh -c "id"', 'command not on the allow-list'],
  ['indirect execution through python', 'python3 -c "import os"', 'command not on the allow-list'],
  ['copying', 'cp "${ROOT}/a" "${ROOT}/b"', 'command not on the allow-list'],
  ['in-place sed', 'sed -i "" s/a/b/ "${ROOT}/x"', 'command not on the allow-list'],
  // The nine holes recorded as outstanding in docs/step2-phase-d-result.md and
  // deferred to this revision. Each line below passed the generator before the
  // corresponding fix, which is why each is here as its own case.
  ['cd to an unchecked destination', 'cd "${HOME}"', 'cd outside the build root'],
  ['cd to an absolute path', 'cd /', 'cd outside the build root'],
  ['an unconstrained xcrun', 'xcrun swift build', 'xcrun is not an allow-listed query'],
  ['xcrun running a tool by name', 'xcrun --find clang', 'xcrun is not an allow-listed query'],
  ['reassigning PATH', 'PATH=/tmp/evil:/usr/bin', 'PATH reassigned'],
  ['process substitution', 'shasum -a 256 <(echo x)', 'process substitution'],
  ['tar in create mode', 'tar -czf /tmp/out.tgz -C "${ROOT}" .', 'tar in create mode'],
  ['the equals form of a swift path option',
    '/usr/bin/swift build --cache-path=/tmp/c -c release --force-resolved-versions',
    'cache-path outside the build root'],
  ['a second mkdir target outside the root', 'mkdir "${ROOT}/ok" /tmp/elsewhere', 'write outside the build root'],
  ['a second touch target outside the root', 'touch "${ROOT}/ok" /tmp/elsewhere', 'write outside the build root'],
  ['find -fprint, which writes a file', 'find "${ROOT}" -maxdepth 2 -fprint /tmp/list', 'mutating find'],
  ['find -fls, which writes a file', 'find "${ROOT}" -maxdepth 2 -fls /tmp/list', 'mutating find'],
  ['a backgrounded command', 'shasum -a 256 "${ROOT}/x" &', 'backgrounded command'],
];

for (const [name, line, expected] of REFUSALS) {
  test(`refuses ${name}`, () => {
    const result = generateWith(line);
    assert.equal(result.ok, false, `expected refusal for: ${line}`);
    assert.match(result.output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

// The declared extra pin exists because one host's toolchain resolves a larger
// graph. It must stay a declaration of one exact package, not a tolerance.
function generateWithArgs(extraArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-phase-d-test-'));
  try {
    copyFileSync(GENERATOR, join(dir, 'gen-phase-d.mjs'));
    copyFileSync(TEMPLATE, join(dir, 'phase-d-build.sh.template'));
    try {
      const stdout = execFileSync(process.execPath, [
        join(dir, 'gen-phase-d.mjs'), '--role', 'intel', '--root', ROOT,
        '--archive', `${ROOT}/src.tgz`, '--archive-sha', SHA, '--out', join(dir, 'out.sh'),
        ...extraArgs,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, output: stdout, script: readFileSync(join(dir, 'out.sh'), 'utf8') };
    } catch (error) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REV = '39f212458aeb88e33bdac2200a793a3f0d55d32b';

test('without a declared extra pin the gate still expects exactly four', () => {
  const result = generateWithArgs([]);
  assert.equal(result.ok, true, result.output);
  assert.match(result.script, /pin count: \$\{PIN_COUNT\} \(expected 4\)/);
  assert.match(result.script, /EXTRA_PIN_ID=''/);
});

test('a declared extra pin raises the expected count to five and names it', () => {
  const result = generateWithArgs(['--expect-extra-pin', `sqlcipher.swift@${REV}`]);
  assert.equal(result.ok, true, result.output);
  assert.match(result.script, /pin count: \$\{PIN_COUNT\} \(expected 5\)/);
  assert.match(result.script, /EXTRA_PIN_ID='sqlcipher\.swift'/);
  assert.match(result.script, new RegExp(`EXTRA_PIN_REV='${REV}'`));
});

for (const [name, value] of [
  ['a revision that is not 40 hex', 'sqlcipher.swift@39f2124'],
  ['an identity with no revision', 'sqlcipher.swift'],
  ['a revision with no identity', `@${REV}`],
  ['an identity carrying shell metacharacters', `sql;rm -rf /@${REV}`],
  ['an uppercase revision', `sqlcipher.swift@${REV.toUpperCase()}`],
]) {
  test(`refuses ${name} as a declared extra pin`, () => {
    const result = generateWithArgs(['--expect-extra-pin', value]);
    assert.equal(result.ok, false, `expected refusal for: ${value}`);
    assert.match(result.output, /--expect-extra-pin must be/);
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
