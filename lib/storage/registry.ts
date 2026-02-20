import type { StorageProvider } from "./interface";
import { SftpProvider } from "./sftp";
import { SmbProvider } from "./smb";

interface ConnectionRecord {
  protocol: string;
  host: string;
  port: number;
  credentials: Record<string, string>;
}

export function createStorageProvider(
  connection: ConnectionRecord
): StorageProvider {
  switch (connection.protocol) {
    case "sftp":
      return new SftpProvider(connection.host, connection.port, {
        username: connection.credentials.username,
        password: connection.credentials.password,
        privateKey: connection.credentials.privateKey,
        passphrase: connection.credentials.passphrase,
      });
    case "smb":
      return new SmbProvider(connection.host, connection.port, {
        username: connection.credentials.username,
        password: connection.credentials.password,
        domain: connection.credentials.domain,
        share: connection.credentials.share,
      });
    default:
      throw new Error(`Unsupported protocol: ${connection.protocol}`);
  }
}
