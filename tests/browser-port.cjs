const net = require('node:net');

// Chromium blocks these ports even when a local HTTP server can bind them.
// Source: https://chromium.googlesource.com/chromium/src/+/main/net/base/port_util.cc
// This set covers ports above the privileged range; lower ports are rejected too.
const blocked = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

module.exports = async function browserPort() {
  for (let attempt = 0; attempt < 64; attempt++) {
    const port = await new Promise((resolve, reject) => {
      const socket = net.createServer();
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const port = socket.address().port;
        socket.close(error => error ? reject(error) : resolve(port));
      });
    });
    if (port >= 1024 && !blocked.has(port)) return port;
  }
  throw Error('Could not allocate a browser-accessible local test port');
};
