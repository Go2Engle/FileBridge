---
id: PGP-Keys
title: PGP Encryption
---

# PGP Encryption

FileBridge supports PGP encryption and decryption of files during transfer. You can encrypt files before uploading them to a destination (e.g. sending sensitive data to a partner) and decrypt PGP-encrypted files after downloading from a source.

---

## How It Works

PGP encryption is configured per-job. When enabled, the transfer engine applies the PGP transform inline — files are encrypted or decrypted as they flow through the pipeline, without writing intermediate files to disk.

```
Source → Download → [PGP Decrypt] → [PGP Encrypt] → Upload → Destination
```

- **Encrypt**: Files are encrypted with the recipient's public key before upload. A `.pgp` extension is appended to the filename.
- **Decrypt**: PGP-encrypted files (`.pgp`, `.gpg`, `.asc`) are decrypted with your private key after download. The PGP extension is stripped from the filename.
- Both can be enabled simultaneously — for example, to re-encrypt files from one key to another.

---

## PGP Key Management

Navigate to **PGP Keys** in the sidebar to manage your keys.

### Key Types

| Type | Description | Use |
|---|---|---|
| **Keypair** | Contains both public and private keys | Encryption and decryption |
| **Public** | Contains only the public key | Encryption only |

### Generating a Key

1. Click **New Key**
2. Select the **Generate** tab
3. Fill in:
   - **Name** — a display name for the key
   - **Algorithm** — ECC Curve25519 (recommended) or RSA 4096
   - **Email** (optional) — embedded in the key's user ID
   - **Passphrase** (optional) — protects the private key
   - **Expiration** — Never, 1 year, 2 years, or 5 years
4. Click **Create**

:::tip
**ECC Curve25519** is recommended for most use cases. It's faster, produces smaller keys, and provides equivalent security to RSA 3072. Use **RSA 4096** only when interoperating with legacy systems that don't support ECC.
:::

### Importing a Key

1. Click **New Key**
2. Select the **Import** tab
3. Paste or upload the armored PGP key block(s):
   - **Public Key** (required) — the `.asc` public key
   - **Private Key** (optional) — needed only for decryption
   - **Passphrase** (optional) — if the private key is passphrase-protected
4. Click **Create**

When importing both a public and private key, FileBridge validates that their fingerprints match.

### Exporting a Key

Click the **download icon** next to any key to export the public key as an `.asc` file. Administrators can also export private keys from the key detail view.

### Key Rotation

To rotate a key (generate a replacement and update all jobs):

1. Click the **rotate icon** (circular arrows) next to a keypair key
2. Configure the new key's parameters (name, algorithm, passphrase, expiration)
3. Click **Rotate Key**

FileBridge will:
- Generate a new keypair
- Automatically update all jobs that referenced the old key to use the new key
- Keep the old key in the list (for decrypting files that were encrypted with it)

You can delete the old key once you're confident it's no longer needed.

---

## Configuring PGP on a Job

Open a job in the **Jobs** page and scroll to the **PGP Encryption** section:

### Encrypt Files Before Upload

- Toggle **Encrypt files before upload**
- Select the PGP key to encrypt with (any key — only the public key is needed)
- Files will have `.pgp` appended to their filename at the destination

### Decrypt PGP Files After Download

- Toggle **Decrypt PGP files after download**
- Select the PGP key to decrypt with (must be a **keypair** — private key required)
- The `.pgp`/`.gpg`/`.asc` extension will be stripped from filenames at the destination

### Combined Encrypt + Decrypt

Both options can be enabled together. The pipeline runs in order: **decrypt first, then encrypt**. This is useful for re-encrypting files from one recipient's key to another.

---

## How PGP Integrates with Other Features

### Archive Extraction

When both **PGP Decrypt** and **Extract Archives** are enabled:
1. The archive is downloaded and decrypted
2. The decrypted content is extracted (ZIP, TAR, TAR.GZ, TGZ)
3. If **PGP Encrypt** is also enabled, each extracted file is encrypted individually before upload

### Delta Sync

Delta sync checks the destination using the **output filename** (after PGP extension changes). For example, if encrypting `report.csv`, delta sync checks for `report.csv.pgp` at the destination.

### Dry Run

The dry run preview shows PGP-related information for each file:
- Whether the file would be decrypted
- Whether the file would be encrypted
- The output filename (with PGP extension changes applied)

### File Size and Progress

When PGP transforms are active, the encrypted/decrypted file size differs from the source file size. The UI shows indeterminate progress for individual files during PGP transfers, while overall job progress (files transferred count) remains accurate.

---

## Security

### Key Storage

- **Private keys** and **passphrases** are encrypted at rest using AES-256-GCM
- The encryption key is derived from `AUTH_SECRET` (via SHA-256)
- Private key material is never returned in API list responses — only the key metadata (name, fingerprint, algorithm) is exposed
- Private key export requires the `admin` role

### Algorithm Support

| Algorithm | Key Size | Performance | Compatibility |
|---|---|---|---|
| ECC Curve25519 | 256-bit | Fast | Modern PGP implementations (GnuPG 2.1+, openpgp.js) |
| RSA 4096 | 4096-bit | Slower | Universal (all PGP implementations) |

### Encryption Library

FileBridge uses [OpenPGP.js](https://openpgpjs.org/) — a pure JavaScript implementation with no native dependencies. This ensures consistent behavior across all deployment platforms (Linux, macOS, Windows, Docker).

---

## API Endpoints

See the [API Reference](API-Reference#pgp-keys) for full endpoint documentation.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/pgp-keys` | List all keys (metadata only) |
| `POST` | `/api/pgp-keys` | Generate or import a key |
| `GET` | `/api/pgp-keys/[id]` | Get a single key |
| `PUT` | `/api/pgp-keys/[id]` | Update key name/description |
| `DELETE` | `/api/pgp-keys/[id]` | Delete a key (blocked if in use) |
| `GET` | `/api/pgp-keys/[id]/export?type=public\|private` | Export key as `.asc` file |
| `POST` | `/api/pgp-keys/[id]/rotate` | Rotate key (generate new + reassign jobs) |
