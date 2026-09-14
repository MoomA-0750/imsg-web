import type { Capability } from '../server/capabilities.js';
export type ChatView = { id: string; name: string; service: string; isGroup: boolean | null; unreadCount: number | null; lastMessageAt: string | null; trimmed: boolean };
/**
 * `id` is set only for an image that is on this Mac and of a type the server
 * will serve at `/api/attachments/:id`. Paths and file names are never sent.
 */
export type AttachmentView = { id: string | null; kind: 'image' | 'video' | 'file'; sticker: boolean };
export type MessageView = { id: string; text: string; isFromMe: boolean; sender: string | null; attachments: AttachmentView[]; createdAt: string | null; trimmed: boolean };
export type ChatSnapshot = { epoch: string; chats: ChatView[]; limit: number };
export type HistorySnapshot = { epoch: string; messages: MessageView[]; limit: number };
export type CapabilitySnapshot = { epoch: string; mode: 'readonly'; features: Record<string, Capability> };
export interface ReadSource {
  chats(limit: number): Promise<ChatSnapshot>;
  history(id: string, limit: number): Promise<HistorySnapshot>;
  capabilities(): Promise<CapabilitySnapshot>;
  close(): Promise<void>;
}
