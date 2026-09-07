import { ReadonlyRpcClient } from './rpc/readonly-client.js';
import { RpcError, isObject } from './rpc/errors.js';
import { parseStatus, type Status } from './capabilities.js';

type Chat = { id: number; name: string; guid: string; service: string };
type Message = { id: number; chatId: number; text: string; guid: string; isFromMe: boolean };
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
function limitValid(limit: number): void { if (!positive(limit) || limit > 1000) throw new RpcError('PARAMS_INVALID'); }

export class ReadonlyAdapter {
  #subscription: number | 'pending' | undefined;
  #unsubscribeTask: Promise<void> | undefined;
  constructor(readonly client: ReadonlyRpcClient) {}
  async status(): Promise<{ raw: unknown; parsed: Status }> {
    const raw = await this.client.request('status');
    const parsed = parseStatus(raw);
    if (!parsed) throw new RpcError('RPC_PROTOCOL_INVALID');
    return { raw, parsed };
  }
  async chats(limit = 50): Promise<Chat[]> {
    limitValid(limit);
    const raw = await this.client.request('chats.list', { limit });
    if (!isObject(raw) || !Array.isArray(raw.chats) || raw.chats.length > limit) throw new RpcError('RPC_PROTOCOL_INVALID');
    return raw.chats.map(item => {
      if (!isObject(item) || !positive(item.id) || typeof item.name !== 'string' || typeof item.guid !== 'string' || typeof item.service !== 'string') throw new RpcError('RPC_PROTOCOL_INVALID');
      return { id: item.id, name: item.name, guid: item.guid, service: item.service };
    });
  }
  async history(chatId: number, limit = 50): Promise<Message[]> {
    limitValid(limit);
    if (!positive(chatId)) throw new RpcError('PARAMS_INVALID');
    const raw = await this.client.request('messages.history', { chat_id: chatId, limit, attachments: false });
    if (!isObject(raw) || !Array.isArray(raw.messages) || raw.messages.length > limit) throw new RpcError('RPC_PROTOCOL_INVALID');
    return raw.messages.map(item => {
      if (!isObject(item) || !positive(item.id) || item.chat_id !== chatId || typeof item.guid !== 'string' || typeof item.text !== 'string' || typeof item.is_from_me !== 'boolean') throw new RpcError('RPC_PROTOCOL_INVALID');
      return { id: item.id, chatId, text: item.text, guid: item.guid, isFromMe: item.is_from_me };
    });
  }
  async subscribe(): Promise<number> {
    if (this.#subscription !== undefined) throw new RpcError('WATCH_ACTIVE');
    this.#subscription = 'pending';
    try {
      const raw = await this.client.request('watch.subscribe', { attachments: false });
      if (!isObject(raw) || !positive(raw.subscription)) throw new RpcError('RPC_PROTOCOL_INVALID');
      this.#subscription = raw.subscription;
      return raw.subscription;
    } catch (error) {
      // An accepted subscription with a malformed response must not leave an untracked watcher.
      await this.client.close();
      throw error;
    }
  }
  unsubscribe(): Promise<void> {
    if (this.#unsubscribeTask) return this.#unsubscribeTask;
    if (this.#subscription === undefined) return Promise.resolve();
    if (this.#subscription === 'pending') return Promise.reject(new RpcError('WATCH_ACTIVE'));
    const subscription = this.#subscription;
    this.#unsubscribeTask = (async () => {
      try {
        const raw = await this.client.request('watch.unsubscribe', { subscription });
        if (!isObject(raw) || raw.ok !== true) throw new RpcError('RPC_PROTOCOL_INVALID');
        this.#subscription = undefined;
      } catch (error) { await this.client.close(); throw error; }
    })().finally(() => { this.#unsubscribeTask = undefined; });
    return this.#unsubscribeTask;
  }
}
