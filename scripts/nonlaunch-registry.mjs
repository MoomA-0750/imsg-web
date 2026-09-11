import { superviseApiWorker } from './supervise-api-worker.mjs';
import { observeResidue } from './nonlaunch-residue.mjs';

// Private fd3 protocol: listener, exactly two registered RPC children, then seal.
// Seal relies on the trusted reader gate forbidding any third/recovery spawn.
export function createRegistryDecoder(workerPid) {
  const pid = n => Number.isSafeInteger(n) && n > 1 && n <= 2147483647;
  if (!pid(workerPid)) throw new Error('REGISTRY_REJECTED');
  let bytes = 0, buffer = Buffer.alloc(0), port, sealed = false, ended = false, failed = false;
  const pids = [workerPid];
  const reject = () => { failed = true; throw new Error('REGISTRY_REJECTED'); };
  return {
    push(chunk) {
      if (failed || ended) reject();
      bytes += chunk.length;
      if (bytes > 1024) reject();
      buffer = Buffer.concat([buffer, chunk]);
      let at;
      while ((at = buffer.indexOf(10)) !== -1) {
        try {
          if (sealed) reject();
          const row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, at)));
          const keys = Object.keys(row).sort().join(',');
          if (!port) {
            if (keys !== 'event,port' || row.event !== 'listener' || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535) reject();
            port = row.port;
          } else if (pids.length < 3) {
            if (keys !== 'event,pid' || row.event !== 'child' || !pid(row.pid) || pids.includes(row.pid)) reject();
            pids.push(row.pid);
          } else {
            if (keys !== 'event' || row.event !== 'sealed') reject();
            sealed = true;
          }
        } catch { reject(); }
        buffer = buffer.subarray(at + 1);
      }
    },
    end() { ended = true; if (buffer.length) reject(); },
    snapshot() { return { pids: [...pids], port, registryComplete: !failed && ended && sealed && buffer.length === 0 }; },
  };
}

// A separate inherited pipe binds records to the owned worker, not to stdout or
// an arbitrary network peer. It does not make an unreviewed worker trustworthy.
export async function superviseRegisteredWorker(createChild, options = {}) {
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error('REGISTRY_REJECTED');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let decoder, stream, rejected = false;
  const reject = () => { rejected = true; controller.abort(); };
  let worker;
  try {
    worker = await superviseApiWorker(() => {
      const child = createChild();
      // Never throw after taking ownership: let the watchdog close the child.
      try {
        decoder = createRegistryDecoder(child.pid);
        stream = child.stdio[3];
        if (!stream?.on || !stream?.destroy) throw new Error();
        stream.on('data', chunk => { try { decoder.push(chunk); } catch { reject(); } });
        stream.on('end', () => { try { decoder.end(); } catch { reject(); } });
        stream.on('error', reject);
      } catch { reject(); }
      return child;
    }, { ...options, signal: controller.signal });
  } finally { options.signal?.removeEventListener('abort', abort); stream?.destroy(); }
  const registry = decoder?.snapshot();
  const complete = !rejected && registry?.registryComplete === true;
  let absence = false, uncertain = true;
  if (complete) {
    try {
      const observation = await observeResidue(registry);
      absence = observation.registeredResourcesAbsent;
      uncertain = observation.observationUncertain;
    } catch {}
  }
  return { ...worker, outcome: worker.outcome === 'ok' ? !complete ? 'registry-incomplete' : !absence ? 'residue-unconfirmed' : 'ok' : worker.outcome,
    registryComplete: complete, registeredResourcesAbsent: absence, observationUncertain: uncertain, safeToRelease: false };
}
