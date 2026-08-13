// ── PEM line-break repair ────────────────────────────────────────────────────
// A single-line HTML <input> strips CR/LF from its value, so a private key
// pasted into one is stored flattened onto a single line. ssh2's key parsers
// require a newline immediately after the BEGIN header and reject the flattened
// form with a bare "Unsupported key format", which reads as though the key
// itself were the wrong type. The connection form now uses a <textarea>, but
// keys saved before that fix are still stored flattened, so repair at the point
// of use rather than on save.

const PEM_LINE_LENGTH = 64;

// Ciphers ssh2 accepts for legacy OpenSSL-encrypted PEM keys, mapped to the hex
// length of their CBC initialization vector. Needed because flattening glues
// the IV to the start of the base64 body with nothing to delimit them.
const IV_HEX_LENGTH: Record<string, number> = {
  "DES-CBC": 16,
  "DES-EDE3-CBC": 16,
  "AES-128-CBC": 32,
  "AES-192-CBC": 32,
  "AES-256-CBC": 32,
};

const RE_LINE_BREAKS_INTACT = /^-----BEGIN [^-\n]+-----\n/;
// [\s\S] rather than the `s` flag: the build targets ES2017, which predates it.
const RE_FLATTENED_BLOCK = /^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/;
const RE_FLATTENED_ENC_HEADERS =
  /^\s*Proc-Type:\s*4,\s*ENCRYPTED\s*DEK-Info:\s*([A-Za-z0-9-]+),\s*([0-9A-Fa-f]+)/;

/**
 * Re-wrap a PEM private key whose line breaks were lost, so ssh2 can parse it.
 * Returns the input untouched when it is already well-formed, is not a PEM
 * block, or cannot be repaired unambiguously — in those cases ssh2's own error
 * is more informative than a mangled guess.
 */
export function normalizePemKey(key: string): string {
  const text = key.replace(/\r\n/g, "\n").trim();
  if (RE_LINE_BREAKS_INTACT.test(text)) return key;

  const block = RE_FLATTENED_BLOCK.exec(text);
  if (!block) return key;

  const [, label, flattened] = block;
  const lines = [`-----BEGIN ${label}-----`];
  let body = flattened;

  const enc = RE_FLATTENED_ENC_HEADERS.exec(body);
  if (enc) {
    const [matched, cipher, hex] = enc;
    const ivLength = IV_HEX_LENGTH[cipher.toUpperCase()];
    if (ivLength === undefined || hex.length < ivLength) return key;
    lines.push("Proc-Type: 4,ENCRYPTED", `DEK-Info: ${cipher},${hex.slice(0, ivLength)}`, "");
    body = hex.slice(ivLength) + body.slice(matched.length);
  }

  body = body.replace(/\s+/g, "");
  if (!body) return key;

  for (let i = 0; i < body.length; i += PEM_LINE_LENGTH) {
    lines.push(body.slice(i, i + PEM_LINE_LENGTH));
  }
  lines.push(`-----END ${label}-----`, "");
  return lines.join("\n");
}
