// Preloaded only by the rapid synthetic harness, including its Jest child.
// Any accidental live provider/network request fails immediately.
const deny = () => {
  console.error('REGRESSION_BLOCKED_EGRESS: offline STPA network request attempted');
  throw new Error('Network access is forbidden in the offline STPA harness.');
};
for (const name of ['node:http', 'node:https']) {
  const transport = require(name); transport.request = deny; transport.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
globalThis.fetch = deny;
if (globalThis.WebSocket) globalThis.WebSocket = class { constructor() { deny(); } };
