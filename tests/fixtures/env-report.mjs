// Reports the environment and working directory it was actually given, so a
// test can assert what leaked rather than assert what was configured.
//
// Variable NAMES only. A value is never echoed: a leaked environment can carry
// the owner's secrets, and a fixture that prints them would put them in test
// output and in CI logs.

import { readdirSync } from 'node:fs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  for (;;) {
    const nl = input.indexOf('\n');
    if (nl < 0) break;
    const raw = input.slice(0, nl);
    input = input.slice(nl + 1);
    const request = JSON.parse(raw);
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        names: Object.keys(process.env).sort(),
        cwd: process.cwd(),
        // /dev/fd exists on both macOS and Linux. A descriptor the child did
        // not ask for is a channel nobody reviewed.
        fds: readdirSync('/dev/fd').map(Number).filter(n => Number.isInteger(n)).sort((a, b) => a - b),
      },
    })}\n`);
  }
});
