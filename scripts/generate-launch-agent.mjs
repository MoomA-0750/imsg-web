// Generates one plist and absent private log placeholders, exclusively.
// Never installs, starts, stops or configures networking.
import { constants } from 'node:fs';
import { lstat, realpath, access, open } from 'node:fs/promises';
import { isAbsolute, normalize, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = () => { throw new Error('Invalid or unsafe launch configuration'); };
const xml = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || /[\x00-\x1f\x7f]/.test(value)) fail();
  return value;
}
function within(base, value) {
  absolute(value);
  const part = relative(base, value);
  if (!part || part === '..' || part.startsWith('../') || isAbsolute(part)) fail();
}
export function validateConfig(c) {
  const keys = Object.keys(c ?? {}).filter(key => key !== 'send').sort().join(',');
  if (!c || keys !== 'base,imsg,label,node,origin,output,port,release,stateName') fail();
  // Sending is off unless explicitly requested. 'dry-run' validates but dispatches nothing; 'live' really sends.
  if (c.send !== undefined && !['off', 'dry-run', 'live'].includes(c.send)) fail();
  absolute(c.base); absolute(c.output); absolute(c.imsg);
  within(join(c.base, 'runtime'), c.node); within(join(c.base, 'releases'), c.release);
  // Production runs a build of ours, so the executable lives under the base
  // this project owns rather than in a package-manager prefix that is
  // group-writable by design and changes under `brew upgrade`.
  within(c.base, c.imsg);
  if (!/^local\.imsg-web(\.[a-z][a-z0-9-]{0,40})?$/.test(c.label) || !/^[a-z][a-z0-9-]{0,31}$/.test(c.stateName)) fail();
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) fail();
  if (typeof c.origin !== 'string') fail();
  const url = new URL(c.origin);
  if (url.protocol !== 'https:' || url.origin !== c.origin || url.username || url.password || url.search || url.hash) fail();
  if (Buffer.byteLength(join(c.base, c.stateName, 'admin.sock')) > 100) fail();
  return c;
}
export function renderLaunchAgent(input) {
  const c = validateConfig(input);
  const str = value => `<string>${xml(value)}</string>`;
  const env = { IMSG_WEB_STATE_DIR: join(c.base, c.stateName), IMSG_WEB_IMSG_PATH: c.imsg, IMSG_WEB_ORIGIN: c.origin, IMSG_WEB_PORT: String(c.port), ...(c.send && c.send !== 'off' ? { IMSG_WEB_SEND: c.send } : {}) };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${str(c.label)}
<key>ProgramArguments</key><array>${[c.node, join(c.release, 'dist/main.js'), 'serve'].map(str).join('')}</array>
<key>WorkingDirectory</key>${str(c.release)}
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key>${str(v)}`).join('')}</dict>
<key>LimitLoadToSessionType</key><string>Aqua</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>ExitTimeOut</key><integer>45</integer><key>Umask</key><integer>63</integer>
<key>AbandonProcessGroup</key><false/>
<key>StandardOutPath</key>${str(join(c.base, 'logs', `${c.label}.out.log`))}
<key>StandardErrorPath</key>${str(join(c.base, 'logs', `${c.label}.err.log`))}
</dict></plist>\n`;
}
async function safeTree(path, uid, allowAdminGroup = false) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const s = await lstat(cursor);
    const stickyRoot = s.isDirectory() && s.uid === 0 && Boolean(s.mode & 0o1000);
    const adminWritable = allowAdminGroup && s.isDirectory() && s.gid === 80 && !(s.mode & 0o002);
    if (s.isSymbolicLink() || (s.uid !== uid && s.uid !== 0) || ((s.mode & 0o022) && !stickyRoot && !adminWritable)) fail();
    if (cursor === dirname(cursor)) break;
  }
}
export async function writeLaunchAgent(c, uid = process.getuid?.()) {
  validateConfig(c);
  if (!uid) fail();
  const base = await lstat(c.base);
  if (!base.isDirectory() || base.uid !== uid || (base.mode & 0o777) !== 0o700) fail();
  await safeTree(c.base, uid);
  for (const directory of [c.release, join(c.base, c.stateName), join(c.base, 'logs'), dirname(c.output)]) {
    await safeTree(directory, uid);
    const s = await lstat(directory);
    if (!s.isDirectory() || s.uid !== uid) fail();
  }
  if (((await lstat(join(c.base, c.stateName))).mode & 0o777) !== 0o700 || ((await lstat(join(c.base, 'logs'))).mode & 0o777) !== 0o700) fail();
  for (const path of [c.node, join(c.release, 'dist/main.js'), join(c.release, 'dist/web/index.html'), join(c.base, c.stateName, 'owner.json')]) {
    await safeTree(path, uid);
    if (!(await lstat(path)).isFile()) fail();
  }
  const owner = await lstat(join(c.base, c.stateName, 'owner.json'));
  if (owner.uid !== uid || (owner.mode & 0o777) !== 0o600) fail();
  // Homebrew imsg is intentionally a symlink. Check its canonical target and parents.
  const imsg = await realpath(c.imsg);
  // Homebrew parents can be admin(gid80)-writable on macOS. The approved
  // deployment trusts local administrators, not arbitrary world-writable dirs.
  // allowAdminGroup was a relaxation for Homebrew's gid-80-writable prefix. A
  // project-owned path needs no such exception, and leaving it on would accept
  // a group-writable directory in the resolved path.
  await safeTree(imsg, uid); await safeTree(dirname(c.imsg), uid);
  await access(imsg, constants.X_OK); await access(c.node, constants.X_OK);
  for (const suffix of ['out', 'err']) {
    try {
      const s = await lstat(join(c.base, 'logs', `${c.label}.${suffix}.log`));
      if (!s.isFile() || s.isSymbolicLink() || s.uid !== uid || (s.mode & 0o777) !== 0o600) fail();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // macOS versions differ in how launchd applies Umask when opening log files.
  // Existing logs are validated above, never truncated; new placeholders are 0600.
  try { await lstat(c.output); fail(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const suffix of ['out', 'err']) {
    const path = join(c.base, 'logs', `${c.label}.${suffix}.log`);
    try { await lstat(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await file.sync(); } finally { await file.close(); }
    }
  }
  const output = await open(c.output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await output.writeFile(renderLaunchAgent(c)); await output.sync(); }
  finally { await output.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch) || process.versions.node !== '24.20.0') fail();
    const args = process.argv.slice(2), values = {};
    if (args.length !== 16 && args.length !== 18) fail();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!['--base', '--release', '--imsg', '--origin', '--port', '--label', '--stateName', '--output', '--send'].includes(key) || key.slice(2) in values) fail();
      values[key.slice(2)] = args[i + 1];
    }
    if (!/^[1-9][0-9]{3,4}$/.test(values.port)) fail();
    await writeLaunchAgent({ ...values, node: process.execPath, port: Number(values.port) });
    process.stdout.write('LaunchAgent plist generated; not installed or started.\n');
  } catch { process.stderr.write('LaunchAgent generation refused. Check paths, ownership, runtime and configuration.\n'); process.exitCode = 1; }
}
