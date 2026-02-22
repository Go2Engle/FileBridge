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
  downloadFile(remotePath: string): Promise<Buffer>;
  uploadFile(content: Buffer, remotePath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  moveFile(sourcePath: string, destinationPath: string): Promise<void>;
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
