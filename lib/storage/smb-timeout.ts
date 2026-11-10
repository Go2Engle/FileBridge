/**
 * SMB2 per-request inactivity timeout for v9u-smb2.
 *
 * v9u-smb2 has no built-in request timeout. SMB2Forge.request sends a packet
 * and registers a callback in connection.responsesCB[messageId] that waits
 * indefinitely. When the server stops responding (socket killed by RST,
 * session expired, network drop) the callback never fires and any awaiting
 * promise hangs forever — wedging the transfer engine until the service is
 * restarted.
 *
 * This patch wraps every SMB2 request callback with an inactivity timeout.
 * On timeout the callback is invoked with a synthetic SMB_REQUEST_TIMEOUT
 * error; a late response is silently dropped because the wrapping flag is
 * already set.
 *
 * Pending requests are tracked per connection. When the connection's socket
 * closes (we disconnected, or the server dropped us) every pending request is
 * failed immediately with SMB_CONNECTION_CLOSED and its timer is cleared, so
 * no timer outlives its connection and fires on a dead socket later.
 *
 * Import this module ONCE after smb-signing.ts (top of smb.ts).
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { createLogger } from "@/lib/logger";
const log = createLogger("smb-timeout");

export const REQUEST_TIMEOUT_MS = 60_000;

interface PendingRequest {
  messageName: string;
  fail: (err: Error) => void;
}

const smb2Forge = require("v9u-smb2/lib/tools/smb2-forge");
const wrappedRequest = smb2Forge.request;

function makeError(code: string, messageName: string, message: string): Error {
  const err: Error & { code?: string; messageName?: string } = new Error(message);
  err.code = code;
  err.messageName = messageName;
  return err;
}

/**
 * Attach (once per connection) a socket "close" listener that fails every
 * request still waiting for a response on that socket.
 */
function pendingFor(connection: any): Set<PendingRequest> {
  if (connection._smbPending) return connection._smbPending;
  const pending = new Set<PendingRequest>();
  connection._smbPending = pending;
  connection.socket?.on?.("close", () => {
    if (pending.size === 0) return;
    log.info("SMB connection closed with requests pending — failing them", {
      host: connection.ip,
      pending: pending.size,
    });
    for (const req of [...pending]) {
      req.fail(
        makeError(
          "SMB_CONNECTION_CLOSED",
          req.messageName,
          `SMB ${req.messageName} aborted — connection closed`,
        ),
      );
    }
  });
  return pending;
}

smb2Forge.request = function (
  messageName: string,
  params: any,
  connection: any,
  cb: any,
) {
  // v9u-smb2 itself treats the callback as optional (`cb && cb(...)`), so
  // fire-and-forget callers are legal. Never invoke a missing callback.
  const callback = typeof cb === "function" ? cb : undefined;
  const pending = pendingFor(connection);
  let settled = false;

  const settle = (args: any[]) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    pending.delete(entry);
    if (!callback) return;
    try {
      callback(...args);
    } catch (err) {
      // A throwing callback here would otherwise escape from a timer or a
      // socket event as an uncaughtException.
      log.error("SMB request callback threw", { host: connection.ip, messageName, err });
    }
  };

  const entry: PendingRequest = { messageName, fail: (err) => settle([err]) };

  const timer = setTimeout(() => {
    if (settled) return;
    log.warn("SMB request timed out — connection likely dead", {
      host: connection.ip,
      messageName,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    settle([
      makeError(
        "SMB_REQUEST_TIMEOUT",
        messageName,
        `SMB ${messageName} timed out after ${REQUEST_TIMEOUT_MS}ms — connection likely dead`,
      ),
    ]);
  }, REQUEST_TIMEOUT_MS);
  // A pending SMB request must not keep the process alive on its own.
  timer.unref?.();
  pending.add(entry);

  const onResponse = function (...args: any[]) {
    settle(args);
  };

  try {
    return wrappedRequest(messageName, params, connection, onResponse);
  } catch (err) {
    // The request was never sent (e.g. message generation threw on bad
    // params), so no response will ever arrive: disarm the timer and let the
    // caller see the synchronous error as before.
    settled = true;
    clearTimeout(timer);
    pending.delete(entry);
    throw err;
  }
};

export {};
