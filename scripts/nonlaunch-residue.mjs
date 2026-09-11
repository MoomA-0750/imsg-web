import { createConnection } from 'node:net';

// Observation only: PID signal 0 never terminates a process; TCP sends no data.
// A reused PID/port is conservatively present. Uncertain errors are not absence.
function processAbsent(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH' ? true : null; }
}
function listenerAbsent(port, timeoutMs) {
  return new Promise(resolve => {
    let result = null;
    const socket = createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.once('connect', () => { result = false; socket.destroy(); });
    socket.once('error', error => { result = error.code === 'ECONNREFUSED' ? true : null; socket.destroy(); });
    socket.once('close', () => { clearTimeout(timer); resolve(result); });
  });
}

// The caller must supply a trusted complete registry from the particular run.
// This does NOT establish registry provenance, discover missing children, close
// resources, release locks, or assert that arbitrary descendants are absent.
export async function observeResidue({ pids, port, registryComplete }, { timeoutMs = 1000 } = {}) {
  if (!Array.isArray(pids) || pids.length < 1 || pids.length > 3
    || new Set(pids).size !== pids.length || !pids.every(p => Number.isSafeInteger(p) && p > 1 && p <= 2147483647)
    || !Number.isInteger(port) || port < 1 || port > 65535 || typeof registryComplete !== 'boolean'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('RESIDUE_CONFIGURATION_REJECTED');
  // Check PID existence before and after the asynchronous port probe. These
  // are observations at instants, not a reservation against reuse after return.
  const before = pids.map(processAbsent);
  const portAbsent = await listenerAbsent(port, timeoutMs);
  const after = pids.map(processAbsent);
  const absent = before.every(v => v === true) && after.every(v => v === true);
  return { gateMeasurement: false, registryComplete, processesAbsent: absent,
    listenerAbsent: portAbsent === true,
    observationUncertain: [...before, ...after, portAbsent].some(v => v === null),
    registeredResourcesAbsent: registryComplete && absent && portAbsent === true,
    safeToRelease: false };
}
