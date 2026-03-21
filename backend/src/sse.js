// src/sse.js — Server-Sent Events broadcaster
// Every device that has the app open connects to /api/events.
// When any device writes data, the server broadcasts a 'sync' event
// and all other devices reload their data automatically.

const clients = new Map(); // res → username

export function addClient(res, username) {
  clients.set(res, username);
  console.log(`[sse] +client (total: ${clients.size})`);
}

export function removeClient(res) {
  clients.delete(res);
  console.log(`[sse] -client (total: ${clients.size})`);
}

// Broadcast only to clients belonging to the same user
export function broadcast(event, data = {}, username) {
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`;
  for (const [res, owner] of clients) {
    if (owner !== username) continue;
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// Keep-alive ping every 25s to prevent proxies from closing idle connections
setInterval(() => {
  const ping = `: ping\n\n`;
  for (const res of clients) {
    try {
      res.write(ping);
    } catch {
      clients.delete(res);
    }
  }
}, 25_000);
