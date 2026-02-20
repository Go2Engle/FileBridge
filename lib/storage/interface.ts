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
 * Convert a glob-style wildcard pattern (e.g. "*.csv") to a RegExp.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
