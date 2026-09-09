import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { spawn } from 'node:child_process';
import { once } from 'node:events';
import { summarize, validateReport, captureChild } from './profile-owned-rpc.mjs';
test('stack summarizer emits only fixed categories, never raw metadata or text', () => {
  const raw = 'Path: /private/SECRET\nCall graph:\n + 42 TCCAccessRequest (in TCC)\n | 30 sqlite3_step (in libsqlite3.dylib)\n : 12 SECRET_MESSAGE_BODY\n + 7 TCCAccessRequest (in TCC)\n';
  const result = summarize(raw);
  assert.equal(result.contactsAuthorization.maxInclusiveStackCount, 42);
  assert.equal(result.sqlite.maxInclusiveStackCount, 30);
  assert.equal(result.preferences.seen, false);
  assert.equal(Object.keys(result).length, 6);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('summary ignores metadata outside graph and zero-count frames', () => {
  const result = summarize(' + 999 TCCAccessRequest\nCall graph:\n    3 Thread_1\n + 0 TCCAccessRequest\n + 2 sqlite3_step\nBinary Images:\n + 888 TCCAccessRequest\n');
  assert.equal(result.contactsAuthorization.seen, false);
  assert.equal(result.sqlite.maxInclusiveStackCount, 2);
  assert.ok(Object.values(summarize(' + 999 TCCAccessRequest')).every(v => !v.seen));
});
test('rejects empty/wrong-target/non-calltree reports and unproven overlap', () => {
  const raw = 'Process: imsg [123]\nParent Process: node [456]\nCall graph:\n    900 Thread_1\n + 10 handleChatsList (in imsg)\n';
  assert.deepEqual(validateReport(raw, 123, 456, 'chats'), { targetVerified: true, structureVerified: true, overlapVerified: true });
  assert.equal(validateReport(raw, 123, 456, 'history').overlapVerified, false);
  assert.throws(() => validateReport(raw, 124, 456, 'chats'));
  assert.throws(() => validateReport(raw, 123, 457, 'chats'));
  assert.throws(() => validateReport('', 123, 456, 'chats'));
  assert.throws(() => validateReport(raw.replace('900', '0'), 123, 456, 'chats'));
  assert.equal(validateReport(raw.replace(' + 10 handleChatsList (in imsg)', '') + '\nMetadata: handleChatsList (in imsg)\n', 123, 456, 'chats').overlapVerified, false);
  assert.equal(validateReport(raw.replace(' + 10 handleChatsList (in imsg)', ' + 0 handleChatsList (in imsg)'), 123, 456, 'chats').overlapVerified, false);
});
test('captures actual child handle and restores builtin even when factory fails', async () => {
  const original = childProcess.spawn;
  await assert.rejects(captureChild(() => { throw Error(); }, process.execPath));
  assert.equal(childProcess.spawn, original); assert.equal(spawn, original);
  const captured = await captureChild(() => spawn(process.execPath, ['rpc'], { shell: false, stdio: ['ignore', 'ignore', 'ignore'] }), process.execPath);
  assert.equal(captured.client, captured.child); assert.ok(captured.child.pid > 1);
  assert.equal(childProcess.spawn, original); assert.equal(spawn, original);
  await once(captured.child, 'close');
});
test('spawn-then-throw restores builtin and waits for child close before rejecting', async () => {
  const original = childProcess.spawn; let child, closed = false;
  await assert.rejects(captureChild(() => {
    child = spawn(process.execPath, ['rpc'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('close', () => { closed = true; });
    throw Error('synthetic constructor failure');
  }, process.execPath));
  assert.equal(closed, true); assert.equal(childProcess.spawn, original); assert.equal(spawn, original);
});
