import type { Capability } from '../server/capabilities.js';
/** `preview` is the newest message in the conversation, clipped; null when there is none to show. */
/** `avatarId` is set only when the address book holds a picture for this conversation's contact. */
export type ChatView = { id: string; name: string; service: string; isGroup: boolean | null; unreadCount: number | null; lastMessageAt: string | null; trimmed: boolean; preview: PreviewView | null; avatarId: string | null };
export type PreviewView = { text: string; trimmed: boolean; fromMe: boolean };
/**
 * `id` is set only for an image the server will serve at `/api/attachments/:id`:
 * the file on this Mac, or with `preview` Messages' cached thumbnail of an image
 * that was never downloaded. Paths and file names are never sent.
 */
export type AttachmentView = { id: string | null; kind: 'image' | 'video' | 'file'; sticker: boolean; preview: boolean };
/** A link preview Messages stored when the link was sent. `url` is always absolute http(s). */
export type LinkView = { url: string; title: string; summary: string; siteName: string; image: AttachmentView | null };
/** The message this one replies to: who wrote it and a clipped quote. No identifiers are sent. */
export type ReplyView = { sender: string | null; text: string; trimmed: boolean };
/** A tapback on this message: its emoji, who put it there (null when the owner did), and how many alike. */
export type ReactionView = { emoji: string; kind: string; senders: string[]; fromMe: boolean; count: number };
export type MessageView = { id: string; text: string; isFromMe: boolean; sender: string | null; avatarId: string | null; attachments: AttachmentView[]; link: LinkView | null; replyTo: ReplyView | null; reactions: ReactionView[]; createdAt: string | null; trimmed: boolean };
export type ChatSnapshot = { epoch: string; chats: ChatView[]; limit: number };
export type HistorySnapshot = { epoch: string; messages: MessageView[]; limit: number };
export type CapabilitySnapshot = { epoch: string; mode: 'readonly'; features: Record<string, Capability> };
export interface ReadSource {
  chats(limit: number): Promise<ChatSnapshot>;
  avatar(id: string): Promise<{ type: string; size: number; bytes: Buffer }>;
  history(id: string, limit: number): Promise<HistorySnapshot>;
  capabilities(): Promise<CapabilitySnapshot>;
  close(): Promise<void>;
}
