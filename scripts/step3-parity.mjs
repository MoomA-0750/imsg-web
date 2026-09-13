// Step3 rung I — baseline vs candidate on the owner's real data.
//
// Runs on the Mac. Values never leave it: what this prints is verdicts, counts,
// record positions and field names drawn from a fixed list. Message text,
// handles, senders and contact names are digested and discarded, never emitted,
// because AGENTS.md forbids logging them regardless of who is watching.
//
// Order is ABBA — baseline, candidate, candidate, baseline — so each arm is
// also compared against itself. With Messages quit the database is static and
// the two runs of an arm must be identical; if they are not, the pair is
// INCONCLUSIVE rather than pass or fail, because a difference between arms
// cannot then be attributed to the arms.
//
// Both arms are asked exactly the same questions: the chat ids come from one
// preflight and are then fixed, so neither arm chooses its own workload.
//
// The comparison is tiered in advance so a mismatch localises itself without
// anyone going back to look at the data a second time:
//
//   1  whole-response digest        equal / not equal
//   2  per-record digests           which record positions differ
//   3  per-field digests            which field names differ
//
// Digests are HMAC-SHA256 under a key generated for this run and never written
// down. A bare SHA-256 of a phone number or a boolean is a dictionary attack,
// not a one-way function.

import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';

const [baseline, candidate, realDb, tmpdir, home, chatLimitRaw, historyLimitRaw, historyChatsRaw] =
  process.argv.slice(2);
if (!baseline || !candidate || !realDb || !tmpdir || !home) {
  console.log('usage: step3-parity.mjs <baseline> <candidate> <realdb> <tmpdir> <home> [chatLimit] [historyLimit] [historyChats]');
  process.exit(64);
}
const chatLimit = Number(chatLimitRaw ?? 25);
const historyLimit = Number(historyLimitRaw ?? 25);
const historyChats = Number(historyChatsRaw ?? 5);

const KEY = randomBytes(32);
const mac = (v) => createHmac('sha256', KEY).update(canonical(v)).digest('hex').slice(0, 16);

// Stable serialisation: key order must not be able to create a false mismatch.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

// Field names may be printed only if they are on this list, which is taken from
// ChatPayload and MessagePayload in the pinned source. Anything else prints as
// `unlisted`, so a field added upstream cannot leak a name derived from data.
const FIELDS = new Set([
  'id', 'name', 'identifier', 'service', 'last_message_at', 'guid', 'display_name',
  'contact_name', 'is_group', 'participants', 'account_id', 'account_login',
  'last_addressed_handle', 'unread_count',
  'chat_id', 'reply_to_guid', 'thread_originator_guid', 'thread_originator_part',
  'reply_to_text', 'reply_to_sender', 'sender', 'sender_name', 'is_from_me', 'text',
  'created_at', 'attachments', 'reactions', 'destination_caller_id',
  'balloon_bundle_id', 'url_preview', 'poll', 'is_reaction', 'reaction_type',
  'reaction_emoji', 'is_reaction_add', 'reacted_to_guid', 'is_read', 'date_read',
]);
const safeField = (n) => (FIELDS.has(n) ? n : 'unlisted');

function runArm(product, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(product, ['rpc', '--db', realDb, '--contacts-from-address-book'], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: tmpdir,
        LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      cwd: tmpdir,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, 180_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const responses = out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
      resolve({ responses, code, signal, stderrBytes: err.length });
    });
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
    child.stdin.end();
  });
}

// Tier 2 aligns by a stable key rather than by position, so one inserted record
// does not make every later position "different" and blow up what gets printed.
function compareRecords(a, b, label) {
  const key = (r) => (r && typeof r === 'object' && 'id' in r ? String(r.id) : null);
  const am = new Map(a.map((r, i) => [key(r) ?? `#${i}`, { r, i }]));
  const bm = new Map(b.map((r, i) => [key(r) ?? `#${i}`, { r, i }]));
  const onlyA = [...am.keys()].filter((k) => !bm.has(k));
  const onlyB = [...bm.keys()].filter((k) => !am.has(k));
  const differing = [];
  for (const [k, av] of am) {
    const bv = bm.get(k);
    if (!bv) continue;
    if (mac(av.r) !== mac(bv.r)) {
      const names = [...new Set([...Object.keys(av.r ?? {}), ...Object.keys(bv.r ?? {})])];
      const fields = names
        .filter((f) => mac(av.r?.[f] ?? null) !== mac(bv.r?.[f] ?? null))
        .map(safeField);
      differing.push({ position: av.i, fields });
    }
  }
  console.log(`  ${label}: counts ${a.length} vs ${b.length}`);
  console.log(`  ${label}: only in first: ${onlyA.length}, only in second: ${onlyB.length}`);
  console.log(`  ${label}: records differing: ${differing.length}`);
  for (const d of differing.slice(0, 20)) {
    console.log(`    position ${d.position}: fields ${d.fields.join(',')}`);
  }
  return onlyA.length === 0 && onlyB.length === 0 && differing.length === 0;
}

// Responses are correlated by their JSON-RPC id, never by arrival order. The
// server answers concurrently: sending chats, hist-0, hist-1 returns hist-1
// before hist-0 on some runs and after it on others, observed directly. An
// earlier version of this file matched by position, which made an arm look
// non-deterministic and very nearly produced "the candidate is unstable" as a
// finding about the product. The application's own client has always keyed by
// id; only this comparator did not.
function resultsOf(arm) {
  const byId = new Map();
  for (const r of arm.responses) {
    if (typeof r.id !== 'string') continue;
    byId.set(r.id, r.result ?? { error: r.error?.code ?? 'unknown' });
  }
  return byId;
}

// Canonical, order-free view of an arm for whole-response digesting.
const asObject = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

function missingIds(m, ids) {
  return ids.filter((id) => !m.has(id));
}

const main = async () => {
  console.log('== step3 parity begin');
  console.log(`date: ${new Date().toISOString()}`);
  console.log(`baseline: ${baseline}`);
  console.log(`candidate: ${candidate}`);
  console.log(`limits: chats=${chatLimit} history=${historyLimit} over ${historyChats} chats`);

  // Preflight: fix the workload once so neither arm picks its own.
  const pre = await runArm(baseline, [{ jsonrpc: '2.0', id: 'pre', method: 'chats.list', params: { limit: chatLimit } }]);
  const chats = pre.responses[0]?.result?.chats ?? [];
  if (chats.length === 0) {
    console.log('ABSOLUTE FAIL: chats.list returned no chats; there is nothing to compare');
    process.exit(70);
  }
  const chatIds = chats.slice(0, historyChats).map((c) => c.id);
  console.log(`chats available: ${chats.length}; history over ${chatIds.length} of them`);

  const requests = [
    { jsonrpc: '2.0', id: 'chats', method: 'chats.list', params: { limit: chatLimit } },
    ...chatIds.map((id, i) => ({ jsonrpc: '2.0', id: `hist-${i}`, method: 'messages.history',
      params: { chat_id: id, limit: historyLimit } })),
  ];

  console.log('== ABBA');
  const a1 = await runArm(baseline, requests);
  const b1 = await runArm(candidate, requests);
  const b2 = await runArm(candidate, requests);
  const a2 = await runArm(baseline, requests);
  for (const [n, arm] of [['baseline#1', a1], ['candidate#1', b1], ['candidate#2', b2], ['baseline#2', a2]]) {
    console.log(`  ${n}: exit=${arm.code} signal=${arm.signal} stderrBytes=${arm.stderrBytes} responses=${arm.responses.length}`);
  }

  console.log('== drift check (same arm, twice)');
  const REQUEST_IDS = requests.map((r) => r.id);
  for (const [n, arm] of [['baseline#1', a1], ['candidate#1', b1], ['candidate#2', b2], ['baseline#2', a2]]) {
    const missing = missingIds(resultsOf(arm), REQUEST_IDS);
    if (missing.length) console.log(`  ${n}: MISSING RESPONSES for ${missing.join(',')}`);
  }
  const baselineStable = mac(asObject(resultsOf(a1))) === mac(asObject(resultsOf(a2)));
  const candidateStable = mac(asObject(resultsOf(b1))) === mac(asObject(resultsOf(b2)));
  console.log(`  baseline stable across its two runs: ${baselineStable}`);
  console.log(`  candidate stable across its two runs: ${candidateStable}`);
  if (!baselineStable || !candidateStable) {
    console.log('INCONCLUSIVE: an arm disagreed with itself, so a difference between arms cannot be attributed');
    // An unstable arm is a finding in its own right, and the same tiered
    // comparison localises it. Stopping at "inconclusive" would leave the more
    // interesting result -- WHICH field is unstable -- unmeasured.
    for (const [label, x, y] of [['baseline', a1, a2], ['candidate', b1, b2]]) {
      if (mac(asObject(resultsOf(x))) === mac(asObject(resultsOf(y)))) continue;
      console.log(`== localising ${label}'s disagreement with itself`);
      const xr = resultsOf(x);
      const yr = resultsOf(y);
      for (const id of REQUEST_IDS) {
        const xv = xr.get(id) ?? {};
        const yv = yr.get(id) ?? {};
        compareRecords(xv.chats ?? xv.messages ?? [], yv.chats ?? yv.messages ?? [], `${label} ${id}`);
      }
    }
    process.exit(75);
  }

  console.log('== tier 1: whole-response digest');
  const equal = mac(asObject(resultsOf(a1))) === mac(asObject(resultsOf(b1)));
  console.log(`  baseline == candidate: ${equal}`);

  if (!equal) {
    console.log('== tier 2/3: localising');
    const ar = resultsOf(a1);
    const br = resultsOf(b1);
    for (const id of REQUEST_IDS) {
      const av = ar.get(id) ?? {};
      const bv = br.get(id) ?? {};
      compareRecords(av.chats ?? av.messages ?? [], bv.chats ?? bv.messages ?? [], id);
    }
  }

  console.log('== absolute checks (parity cannot provide these)');
  const listed = resultsOf(a1).get('chats')?.chats ?? [];
  const phoneish = (s) => typeof s === 'string' && /^\+?[0-9][0-9 ()-]{5,}$/.test(s);
  const emailish = (s) => typeof s === 'string' && s.includes('@');
  const resolved = listed.filter((c) => typeof c.contact_name === 'string' && c.contact_name.length > 0);
  const phoneResolved = resolved.filter((c) => phoneish(c.identifier));
  const emailResolved = resolved.filter((c) => emailish(c.identifier));
  console.log(`  chats: ${listed.length}`);
  console.log(`  with a resolved contact_name: ${resolved.length}`);
  console.log(`  of those, phone-shaped identifier: ${phoneResolved.length}`);
  console.log(`  of those, email-shaped identifier: ${emailResolved.length}`);
  const verdict = phoneResolved.length > 0 ? 'PASS'
    : resolved.length > 0 ? 'EMAIL-ONLY (not a pass: phone normalisation is untested)'
      : 'FAIL (no name resolved at all)';
  console.log(`  absolute verdict: ${verdict}`);

  const messageCounts = REQUEST_IDS.filter((i) => i !== 'chats')
    .map((i) => (resultsOf(a1).get(i)?.messages ?? []).length);
  console.log(`  messages per history call: ${messageCounts.join(',')}`);

  console.log(`== PARITY: ${equal ? 'EQUAL' : 'DIFFERENT'}`);
  console.log('== step3 parity end');
};

main().catch((e) => { console.log(`fatal: ${e.message}`); process.exit(1); });
