// Synthetic orphan fixture: exits on its own after 1.8s; no files or subprocesses.
import { createServer } from 'node:net';
const server = createServer(socket => socket.destroy());
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ pid: process.pid, port: server.address().port }) + '\n');
  setTimeout(() => { server.close(); }, 1800);
});
