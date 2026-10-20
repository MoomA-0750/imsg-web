import { createServer, type Server } from 'node:https';
import { Auth } from './auth.js';
import { OwnerStore } from './owner-store.js';
import { startAdmin } from './admin.js';
import { createApp } from './http.js';
import type { ReadSource } from '../shared/web-types.js';
import type { AttachmentSource } from './attachments.js';
import type { Sender } from './send-service.js';
import type { UploadSink } from './http.js';
import { WebError } from './web-error.js';

async function bounded(work: Promise<unknown>, ms = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new WebError('SHUTDOWN_INCOMPLETE')), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function startRuntime(options: { store: OwnerStore; source: ReadSource & AttachmentSource; sender?: Sender; uploads?: UploadSink & { close(): Promise<void> }; origin: string; port: number; lan?: { origin: string; cert: Buffer; key: Buffer }; webDir?: string }) {
  // Disabled placeholder; startAdmin loads the real hash under exclusive lock.
  const auth = new Auth('0'.repeat(64)); auth.block();
  const admin = await startAdmin(options.store, auth);
  let app: Awaited<ReturnType<typeof createApp>>;
  let lan: Server | undefined;
  try {
    app = await createApp({ auth, source: options.source, origin: options.origin, ...(options.lan ? { lanOrigin: options.lan.origin } : {}), ...(options.sender ? { sender: options.sender } : {}), ...(options.uploads ? { uploads: options.uploads } : {}), ...(options.webDir ? { webDir: options.webDir } : {}) });
    await app.listen({ host: '127.0.0.1', port: options.port });
    if (options.lan) {
      // The LAN way in is the same app behind TLS this server carries itself; the loopback listener
      // above stays plain http, for the Mac itself and for anything (Tailscale Serve) in front of it.
      lan = createServer({ cert: options.lan.cert, key: options.lan.key, requestTimeout: 15_000, keepAliveTimeout: 5000 }, (request, response) => app.routing(request, response));
      lan.maxConnections = 64; lan.setTimeout(15_000);
      const port = Number(new URL(options.lan.origin).port);
      try { await new Promise<void>((resolve, reject) => { lan!.once('error', reject).listen({ host: '::', port }, () => { lan!.off('error', reject); resolve(); }); }); }
      catch (error) { await app.close().catch(() => {}); throw error; }
    }
  } catch (error) { await admin.close(true); throw error; }
  let stopping: Promise<void> | undefined;
  return { app, auth, close() {
    return stopping ??= (async () => {
      auth.block();
      const lanClose = lan ? new Promise<void>(resolve => lan!.close(() => resolve())) : Promise.resolve();
      lan?.closeIdleConnections();
      const httpClose = app.close();
      try { await bounded(lanClose); } catch { lan!.closeAllConnections(); }
      let httpStopped = true;
      try { await bounded(httpClose); } catch { httpStopped = false; app.server.closeAllConnections(); await bounded(httpClose).catch(() => {}); }
      // Nothing an owner uploaded outlives the server.
      await bounded(options.uploads?.close() ?? Promise.resolve()).catch(() => {});
      let readerStopped = false;
      try { await bounded(options.source.close()); readerStopped = true; }
      finally { await bounded(admin.close(readerStopped && httpStopped), 5500); }
      if (!readerStopped || !httpStopped) throw new WebError('SHUTDOWN_INCOMPLETE');
    })();
  } };
}
