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
 * Import this module ONCE after smb-signing.ts (top of smb.ts).
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
import { createLogger } from "@/lib/logger";
const log = createLogger("smb-timeout");

const REQUEST_TIMEOUT_MS = 60_000;

const smb2Forge = require("v9u-smb2/lib/tools/smb2-forge");
const wrappedRequest = smb2Forge.request;

smb2Forge.request = function (
  messageName: string,
  params: any,
  connection: any,
  cb: any,
) {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    log.warn("SMB request timed out — connection likely dead", {
      host: connection.ip,
      messageName,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    const err: Error & { code?: string; messageName?: string } = new Error(
      `SMB ${messageName} timed out after ${REQUEST_TIMEOUT_MS}ms — connection likely dead`,
    );
    err.code = "SMB_REQUEST_TIMEOUT";
    err.messageName = messageName;
    cb(err);
  }, REQUEST_TIMEOUT_MS);

  const onResponse = function (err: any, ...rest: any[]) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    cb(err, ...rest);
  };

  return wrappedRequest(messageName, params, connection, onResponse);
};

export {};
