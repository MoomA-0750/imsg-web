// Owns one explicitly named temporary Agent. No raw stack/error output exported.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
const run = promisify(execFile), check = v => { if (!v) throw new Error(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = process.env.IMSG_WEB_PROFILE_DIR, label = 'local.imsg-web.perf-profile';
const domain = `gui/${process.getuid?.()}`, target = `${domain}/${label}`;
const ctl = args => run('/bin/launchctl', args, { timeout: args[0] === 'bootout' ? 50000 : 5000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
let attempted = false, stopped = false;
async function readSummary() {
  const path = join(root, 'profile.out.log'); const s = await lstat(path);
  check(s.isFile() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o600 && s.size <= 65536);
  const raw = await readFile(path, 'utf8'), complete = raw.slice(0, raw.lastIndexOf('\n') + 1);
  return complete.trim() ? complete.trim().split('\n').map(JSON.parse) : [];
}
async function ownedJob() {
  const { stdout } = await ctl(['print', target]);
  const path = stdout.match(/^\s*path = (.+)$/m)?.[1];
  check(path && await realpath(path) === await realpath(join(root, 'profile.plist')));
  return stdout;
}
async function stop() {
  await ownedJob(); await ctl(['bootout', target]); stopped = true;
}
async function main() {
  check(process.platform === 'darwin' && process.getuid?.() > 0 && root?.startsWith('/'));
  const s = await lstat(root); check(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
  const plist = join(root, 'profile.plist'); await run('/usr/bin/plutil', ['-lint', plist], { timeout: 5000 });
  await ctl(['print', domain]);
  let absent = false;
  try { await ctl(['print', target]); } catch (e) { check(e.code === 113); absent = true; }
  check(absent);
  attempted = true; await ctl(['bootstrap', domain, plist]);
  const began = Date.now(); let successful = false;
  try {
    while (Date.now() - began < 120000) {
      const report = await ownedJob();
      if (!/^\s*pid = \d+$/m.test(report) && /^\s*last exit code = -?\d+$/m.test(report)) {
        check(/^\s*last exit code = 0$/m.test(report));
        const rows = await readSummary(), end = rows.at(-1);
        check(end?.completed === true && end.childStopConfirmed === true);
        const error = await readFile(join(root, 'profile.err.log'), 'utf8'); check(error === '\n');
        successful = true; break;
      }
      await sleep(1000);
    }
    check(successful);
  } finally {
    await stop();
    const rows = await readSummary();
    const pids = rows.flatMap(r => r.event === 'owned-child' ? [r.parentPid, r.childPid] : r.event === 'owned-sampler' ? [r.samplerPid] : []).filter(n => Number.isSafeInteger(n) && n > 1);
    check(pids.length >= 2);
    let absent = false;
    for (let i = 0; i < 30; i++) {
      const { stdout } = await run('/bin/ps', ['-axo', 'pid='], { timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
      const present = new Set(stdout.trim().split(/\s+/).map(Number));
      if (pids.every(pid => !present.has(pid))) { absent = true; break; }
      await sleep(1000);
    }
    check(absent);
    process.stdout.write(JSON.stringify({ supervisorStopped: true, recordedProcessesAbsent: true, successful }) + '\n');
  }
}
main().catch(async () => {
  if (attempted && !stopped) { try { await stop(); } catch {} }
  process.stderr.write('Profile supervision failed; preserve reports, do not retry or elevate privileges, verify exact owned job/processes before continuing.\n'); process.exitCode = 1;
});
