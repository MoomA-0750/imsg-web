// Step3 rung H2 — run one `status` through the dedicated Node, under launchd.
//
// H1 established that `--contacts-from-address-book` works when the responsible
// process is sshd. Production's responsible process is the dedicated Node, which
// holds Full Disk Access. Whether that attribution behaves the same way is the
// open question, and it cannot be asked over SSH: a process started from an SSH
// session is attributed to sshd no matter what launches it further down.
//
// So this runs as a LaunchAgent, started by launchd, executing the dedicated
// Node, which spawns imsg. That is the production chain.
//
// Why this is JavaScript and not a generated shell script: the three shell
// generators guard shell hazards -- word splitting, command substitution,
// redirection, a command name coming from a variable. None of those exist here.
// The child is spawned with an explicit argv array and `shell: false`, so there
// is no shell to guard. The properties that matter are kept small enough to
// read in one sitting:
//
//   - exactly one child, one fixed argv, no shell
//   - the environment is built here, not inherited: the Phase C allow-list
//   - nothing is written; the Agent's plist owns the log file
//   - only derived facts are printed. `contacts.available` is a boolean, and no
//     contact, chat, message or handle is ever read out of the response.
//
// The database is a fixture. This rung does not open the real one.

import { spawn } from 'node:child_process';

const [product, fixture, tmpdir, home] = process.argv.slice(2);
if (!product || !fixture || !tmpdir || !home) {
  console.log('usage: probe.mjs <product> <fixture> <tmpdir> <home>');
  process.exit(64);
}

console.log('== step3 h2 probe begin');
console.log(`date: ${new Date().toISOString()}`);
console.log(`ppid: ${process.ppid}`);
console.log(`node: ${process.execPath}`);
console.log(`product: ${product}`);

const env = {
  HOME: home,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  TMPDIR: tmpdir,
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
};
// Proof that nothing else reached the child, printed rather than asserted so a
// leak shows up in the record instead of only failing.
console.log(`child env keys: ${Object.keys(env).sort().join(',')}`);
console.log(`SSH_CONNECTION in this process: ${process.env.SSH_CONNECTION === undefined ? 'absent' : 'PRESENT'}`);

const child = spawn(product, ['rpc', '--db', fixture, '--contacts-from-address-book'], {
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
  cwd: tmpdir,
});

let out = '';
let err = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { err += c; });

const timer = setTimeout(() => {
  console.log('no response within the bound - killing');
  child.kill('SIGKILL');
}, 30_000);

child.on('close', (code, signal) => {
  clearTimeout(timer);
  console.log(`product exit: code=${code} signal=${signal}`);
  console.log(`stderr bytes: ${err.length}`);

  let parsed;
  try {
    parsed = JSON.parse(out.split('\n').find((l) => l.trim().startsWith('{')) ?? '');
  } catch {
    console.log(`response did not parse; bytes=${out.length}`);
    process.exit(65);
  }
  const r = parsed.result ?? {};
  // Named fields only. Never the whole response, which is how a future method
  // with a richer payload would end up in a log file.
  console.log(`contacts.available: ${r.contacts?.available}`);
  console.log(`database.ready: ${r.database?.ready}`);
  console.log(`database.path is the fixture: ${r.database?.path === fixture}`);
  console.log(`bridge.ready: ${r.bridge?.ready}`);
  console.log(`version: ${r.version}`);
  console.log('== step3 h2 probe end');
  process.exit(0);
});

child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'h2-1', method: 'status', params: {} })}\n`);
child.stdin.end();
