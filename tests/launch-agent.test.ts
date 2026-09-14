import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, lstat, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
// Pure generator tests do not install an Agent or touch real Mac files.
// @ts-expect-error build-independent mjs entrypoint
import { renderLaunchAgent, validateConfig, writeLaunchAgent } from '../scripts/generate-launch-agent.mjs';
const config = { base: '/Users/test/Library/imsg-web', node: '/Users/test/Library/imsg-web/runtime/node/bin/node', release: '/Users/test/Library/imsg-web/releases/abc', imsg: '/Users/test/Library/imsg-web/imsg/imsg', origin: 'https://host.example.ts.net', port: 8787, label: 'local.imsg-web.readonly', stateName: 'state', output: '/Users/test/Library/LaunchAgents/local.imsg-web.readonly.plist' };
describe('C01 LaunchAgent generator', () => {
  it('renders fixed direct argv, private environment and bounded non-restarting lifecycle', () => {
    const xml = renderLaunchAgent(config);
    expect(xml).toContain('<key>ProgramArguments</key><array><string>' + config.node + '</string><string>' + config.release + '/dist/main.js</string><string>serve</string></array>');
    expect(xml).toContain('<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>');
    expect(xml).toContain('<key>ExitTimeOut</key><integer>45</integer>');
    expect(xml).toContain('<key>Umask</key><integer>63</integer>');
    expect(xml).toContain('<key>AbandonProcessGroup</key><false/>');
    expect(xml).not.toMatch(/bash|zsh|Password|TOKEN|KEY/);
    expect(xml.match(/<key>IMSG_WEB_/g)).toHaveLength(4);
  });
  it.each([{ port: 0 }, { port: 65536 }, { port: 8787.1 }, { origin: 'http://host' }, { origin: 'https://host/' }, { origin: 'https://a:b@host' }, { origin: 'https://host?q=1' }, { label: '../escape' }, { stateName: '..' }, { node: '/usr/local/bin/node' }, { release: '/outside' }, { release: config.release + '/../abc' }, { imsg: 'imsg' }, { imsg: '/opt/homebrew/bin/imsg' }, { imsg: '/usr/local/bin/imsg' }, { output: 'relative' }, { base: '/Users/' + 'a'.repeat(100) }, { secret: 'bad' }])('rejects invalid configuration %j', change => { expect(() => validateConfig({ ...config, ...change })).toThrow(); });
  it('escapes XML without shell interpolation', () => {
    expect(renderLaunchAgent({ ...config, imsg: '/Users/test/Library/imsg-web/A&B<"\'>/imsg' })).toContain('A&amp;B&lt;&quot;&apos;&gt;');
  });
});
const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function diskFixture() {
  const base = await mkdtemp('/tmp/iw-gen-'); temporary.push(base);
  const c = { ...config, base, node: join(base, 'runtime/node'), release: join(base, 'releases/a'), imsg: join(base, 'imsg'), output: join(base, 'agent.plist') };
  for (const part of ['runtime', 'releases/a/dist/web', 'state', 'logs']) await mkdir(join(base, part), { recursive: true, mode: 0o700 });
  for (const path of [c.node, c.imsg, join(c.release, 'dist/main.js'), join(c.release, 'dist/web/index.html')]) await writeFile(path, 'synthetic', { mode: 0o700 });
  await writeFile(join(base, 'state/owner.json'), '{}', { mode: 0o600 });
  return c;
}
describe('C01 exclusive filesystem output', () => {
  it('writes only a private plist and refuses existing output without changing it', async () => {
    const c = await diskFixture(); await writeLaunchAgent(c);
    for (const suffix of ['out', 'err']) expect((await lstat(join(c.base, 'logs', `${c.label}.${suffix}.log`))).mode & 0o777).toBe(0o600);
    expect((await lstat(c.output)).mode & 0o777).toBe(0o600);
    const before = await readFile(c.output, 'utf8'); expect(before).toBe(renderLaunchAgent(c));
    await expect(writeLaunchAgent(c)).rejects.toThrow(); expect(await readFile(c.output, 'utf8')).toBe(before);
  });
  it('rejects root, loose state, symlink output and symlink release ancestors', async () => {
    const c = await diskFixture();
    await expect(writeLaunchAgent(c, 0)).rejects.toThrow();
    await chmod(join(c.base, 'state'), 0o755); await expect(writeLaunchAgent(c)).rejects.toThrow();
    await chmod(join(c.base, 'state'), 0o700);
    await symlink(c.imsg, c.output); await expect(writeLaunchAgent(c)).rejects.toThrow();
    expect(await readFile(c.imsg, 'utf8')).toBe('synthetic');
    await symlink(c.release, join(c.base, 'releases/link'));
    await expect(writeLaunchAgent({ ...c, release: join(c.base, 'releases/link'), output: join(c.base, 'other.plist') })).rejects.toThrow();
  });
  it('rejects unsafe existing log and does not truncate private existing logs', async () => {
    const c = await diskFixture(), path = join(c.base, 'logs', `${c.label}.out.log`);
    await writeFile(path, 'existing synthetic evidence', { mode: 0o644 });
    await expect(writeLaunchAgent(c)).rejects.toThrow();
    await chmod(path, 0o600); await writeLaunchAgent(c);
    expect(await readFile(path, 'utf8')).toBe('existing synthetic evidence');
  });
});
