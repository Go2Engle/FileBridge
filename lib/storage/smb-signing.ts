/**
 * SMB2 message signing support for v9u-smb2.
 *
 * v9u-smb2 does not implement SMB2 message signing. Domain-joined Windows
 * servers commonly require it (Group Policy: "Digitally sign communications
 * (always)"). Without signing, TREE_CONNECT fails with STATUS_ACCESS_DENIED
 * even though NTLM auth succeeds.
 *
 * This module monkey-patches v9u-smb2 and ntlm2 at require-time to:
 *   1. Capture the NTLMv2 session key during authentication
 *   2. Detect when the server requires signing (NEGOTIATE SecurityMode)
 *   3. Sign all outgoing SMB2 messages after session setup
 *
 * Import this module ONCE before creating any SMB2 clients (e.g. top of smb.ts).
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const crypto = require("crypto");
const ntlmHashMod = require("ntlm2/lib/hash");

import { createLogger } from "@/lib/logger";
const log = createLogger("smb-signing");

// ── 1. Intercept NTLMv2 response to capture session key material ────────────

let _lastNtProofStr: Buffer | null = null;
let _lastNtlm2Hash: Buffer | null = null;

const origCreateNTLMv2Response = ntlmHashMod.createNTLMv2Response;
ntlmHashMod.createNTLMv2Response = function (
  type2message: any,
  username: string,
  ntlmhash: Buffer,
  nonce: string,
  targetName: string
) {
  const result = origCreateNTLMv2Response(
    type2message,
    username,
    ntlmhash,
    nonce,
    targetName
  );

  // result.key = NTProofStr = HMAC-MD5(NTLMv2Hash, challenge + blob)
  _lastNtProofStr = result.key;
  // NTLMv2Hash = HMAC-MD5(NT_Hash, UPPER(username) + targetName in UCS-2)
  // This is a private function in ntlm2/lib/hash.js, so we compute it inline.
  const hmac = crypto.createHmac("md5", ntlmhash);
  hmac.update(Buffer.from(username.toUpperCase() + (targetName || ""), "ucs2"));
  _lastNtlm2Hash = hmac.digest();

  return result;
};

/**
 * Derive the SMB2 signing key from captured NTLMv2 auth data.
 * SessionBaseKey = HMAC-MD5(NTLMv2Hash, NTProofStr)  [MS-NLMP §3.4.1]
 *
 * For SMB 2.0.2 / 2.1 (the dialects v9u-smb2 negotiates), the signing
 * key IS the SessionBaseKey directly (no KDF derivation needed).
 */
function computeSessionKey(): Buffer | null {
  if (_lastNtProofStr && _lastNtlm2Hash) {
    return crypto
      .createHmac("md5", _lastNtlm2Hash)
      .update(_lastNtProofStr)
      .digest();
  }
  return null;
}

// ── 2. Patch NEGOTIATE to capture server SecurityMode ───────────────────────

const negotiateMsg = require("v9u-smb2/lib/messages/negotiate");

negotiateMsg.onSuccess = function (connection: any, response: any) {
  const r = response.getResponse();
  if (r.SecurityMode) {
    // Response fields are raw Buffers from readData()
    const secMode = Buffer.isBuffer(r.SecurityMode)
      ? r.SecurityMode.readUInt16LE(0)
      : Number(r.SecurityMode);
    connection.serverSecurityMode = secMode;
    // Bit 1 (0x02) = SMB2_NEGOTIATE_SIGNING_REQUIRED
    connection.requireSigning = !!(secMode & 0x02);
    if (connection.requireSigning) {
      log.info("Server requires SMB2 signing", {
        host: connection.ip,
        securityMode: `0x${secMode.toString(16)}`,
      });
    }
  }
};

// ── 3. Patch SESSION_SETUP step 2 to store session key after auth ───────────

const sessionSetup2Msg = require("v9u-smb2/lib/messages/session_setup_step2");

sessionSetup2Msg.onSuccess = function (connection: any) {
  const key = computeSessionKey();
  if (key) {
    connection.sessionKey = key;
    log.info("Session key captured for SMB2 signing", { host: connection.ip });
  }
  // Clear module-level captures
  _lastNtProofStr = null;
  _lastNtlm2Hash = null;
};

// ── 4. Patch SMB2 forge to sign outgoing messages ───────────────────────────

const smb2Forge = require("v9u-smb2/lib/tools/smb2-forge");
const origRequest = smb2Forge.request;

smb2Forge.request = function (
  messageName: string,
  params: any,
  connection: any,
  cb: any
) {
  // After session setup, if signing is required, patch socket.write to sign
  // all outgoing SMB2 messages. The patch is applied once per connection.
  if (
    connection.requireSigning &&
    connection.sessionKey &&
    !connection._signingPatched
  ) {
    connection._signingPatched = true;
    const origSocketWrite = connection.socket.write;
    connection.socket.write = function (this: any, ...args: any[]) {
      const buffer = args[0];
      if (
        Buffer.isBuffer(buffer) &&
        buffer.length > 68 &&
        // Verify SMB2 magic: 0xFE 'S' 'M' 'B' at offset 4 (after NetBIOS header)
        buffer[4] === 0xfe &&
        buffer[5] === 0x53 &&
        buffer[6] === 0x4d &&
        buffer[7] === 0x42
      ) {
        signSMB2Message(buffer, 4, connection.sessionKey);
      }
      return origSocketWrite.apply(this, args);
    };
    log.info("SMB2 message signing activated", { host: connection.ip });
  }

  return origRequest(messageName, params, connection, cb);
};

/**
 * Sign an SMB2 message in-place within a NetBIOS-framed buffer.
 *
 * SMB 2.0.2 / 2.1 signing algorithm:
 *   1. Set SMB2_FLAGS_SIGNED (0x08) in the Flags header field
 *   2. Zero out the 16-byte Signature field
 *   3. Compute HMAC-SHA256(SigningKey, entireSMB2Message)
 *   4. Copy first 16 bytes of HMAC to the Signature field
 */
function signSMB2Message(
  buffer: Buffer,
  smbOffset: number,
  sessionKey: Buffer
): void {
  const flagsOffset = smbOffset + 16;
  const signatureOffset = smbOffset + 48;

  // 1. Set SMB2_FLAGS_SIGNED
  const flags = buffer.readUInt32LE(flagsOffset);
  buffer.writeUInt32LE(flags | 0x00000008, flagsOffset);

  // 2. Zero signature field
  buffer.fill(0, signatureOffset, signatureOffset + 16);

  // 3. HMAC-SHA256 over the SMB2 portion (excludes 4-byte NetBIOS header)
  const smbMessage = buffer.subarray(smbOffset);
  const hmac = crypto.createHmac("sha256", sessionKey);
  hmac.update(smbMessage);
  const signature: Buffer = hmac.digest().subarray(0, 16);

  // 4. Write signature
  signature.copy(buffer, signatureOffset);
}

export {};
