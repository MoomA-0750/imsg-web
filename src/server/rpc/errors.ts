export type ErrorCode =
  | 'CONFIG_INVALID' | 'METHOD_FORBIDDEN' | 'PARAMS_INVALID'
  | 'QUEUE_OVERFLOW' | 'REQUEST_TOO_LARGE' | 'RPC_TIMEOUT' | 'ABORTED'
  | 'RPC_CLOSED' | 'RPC_EOF' | 'RPC_SPAWN_FAILED' | 'RPC_IO_ERROR'
  | 'RPC_PROTOCOL_INVALID' | 'RPC_FRAME_TOO_LARGE' | 'RPC_REMOTE_ERROR'
  | 'SHUTDOWN_FAILED' | 'WATCH_ACTIVE' | 'CLI_STATUS_INVALID';

// Never attach raw upstream messages, data, paths, or cause to printable errors.
export class RpcError extends Error {
  constructor(public readonly code: ErrorCode, public readonly remoteCode?: number) {
    super(code);
    this.name = 'RpcError';
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
