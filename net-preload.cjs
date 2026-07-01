"use strict";
const http = require("node:http");

const TRUSTED_HEADER = "x-aigloo-real-ip";
const origCreateServer = http.createServer.bind(http);

/**
 * Patches http.createServer so every request carries the real TCP peer
 * address under one trusted header name, regardless of how the process was
 * started (standalone server.js, `next dev`, `next start`). Forwarding
 * headers (X-Forwarded-For / X-Real-IP) are only honored when the TCP peer
 * itself is loopback (a local reverse proxy) — never trusted from a
 * directly-connected, and therefore spoofable, remote client.
 *
 * Loaded via NODE_OPTIONS=--require (set in src/cli.ts's spawnDashboard), so
 * this runs before Next.js ever calls http.createServer itself.
 */
http.createServer = function patchedCreateServer(...args) {
  const handlerIndex = args.findIndex((a) => typeof a === "function");
  if (handlerIndex === -1) return origCreateServer(...args);

  const handler = args[handlerIndex];
  const wrapped = function (req, res) {
    const socketIp = (req.socket && req.socket.remoteAddress) || "";
    const isLoopbackPeer = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const forwarded = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");

    // Strip any client-supplied value under our trusted header name first —
    // otherwise a client could set it directly and skip the socket check below.
    delete req.headers[TRUSTED_HEADER];
    req.headers[TRUSTED_HEADER] = isLoopbackPeer && forwarded ? forwarded : socketIp;

    return handler(req, res);
  };

  const rest = args.slice();
  rest[handlerIndex] = wrapped;
  return origCreateServer(...rest);
};
