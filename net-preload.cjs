"use strict";
const http = require("node:http");

const TRUSTED_HEADER = "x-aigloo-real-ip";

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Core trust decision, extracted as a pure function for unit testing (see
 * tests/net-preload.test.ts) — forwarding headers are only honored when the
 * TCP peer itself is loopback (a local reverse proxy); a directly-connected,
 * non-loopback peer's claimed X-Forwarded-For/X-Real-IP is ignored entirely,
 * since that's exactly the spoofable case.
 */
function resolveRealIp(socketIp, headers) {
  const xff = headers["x-forwarded-for"];
  const xRealIp = headers["x-real-ip"];
  const forwarded = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
  return isLoopback(socketIp) && forwarded ? forwarded : socketIp;
}

const origCreateServer = http.createServer.bind(http);

/**
 * Patches http.createServer so every request carries the real TCP peer
 * address under one trusted header name, regardless of how the process was
 * started (standalone server.js, `next dev`, `next start`).
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

    // Strip any client-supplied value under our trusted header name first —
    // otherwise a client could set it directly and skip the socket check below.
    delete req.headers[TRUSTED_HEADER];
    req.headers[TRUSTED_HEADER] = resolveRealIp(socketIp, req.headers);

    return handler(req, res);
  };

  const rest = args.slice();
  rest[handlerIndex] = wrapped;
  return origCreateServer(...rest);
};

module.exports = { resolveRealIp, isLoopback, TRUSTED_HEADER };
