import type { Readable } from "stream";

export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: Date;
  isDirectory: boolean;
}

export interface StorageProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listFiles(path: string, filter?: string): Promise<FileInfo[]>;
  /** List all entries (files + directories) at a path for UI browsing. */
  listDirectory(path: string): Promise<FileInfo[]>;
  /**
   * @param sizeHint Optional file size in bytes from the directory listing.
   *   Providers that cannot stream (e.g. SMB) use this to decide whether to
   *   spool the download to a temp file so the RAM buffer is freed before the
   *   upload begins.
   */
  downloadFile(remotePath: string, sizeHint?: number): Promise<Readable>;
  uploadFile(stream: Readable, remotePath: string, sizeHint?: number): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  moveFile(sourcePath: string, destinationPath: string): Promise<void>;
  /** Create a new directory at the given path. */
  createDirectory(path: string): Promise<void>;
  /**
   * Return the server's working directory for the connected user.
   * Only implemented by providers that support it (e.g. SFTP).
   * Used to auto-detect the starting browse path when none is configured.
   */
  getWorkingDirectory?(): Promise<string>;
}

/**
 * Convert one or more comma-separated glob-style wildcard patterns to a RegExp.
 * An empty string matches everything (same as "*").
 * Examples: "*.csv" → matches .csv files; "*.csv, *.txt" → matches either.
 */
export function globToRegex(pattern: string): RegExp {
  const trimmed = pattern.trim();
  if (!trimmed) return /^.*$/i;

  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const escaped = p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      return `^${escaped}$`;
    });

  return new RegExp(parts.join("|"), "i");
}
