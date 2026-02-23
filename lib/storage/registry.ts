import type { StorageProvider } from "./interface";
import { SftpProvider } from "./sftp";
import { SmbProvider } from "./smb";
import { AzureBlobProvider } from "./azure-blob";
import { LocalProvider } from "./local";

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
    case "azure-blob":
      return new AzureBlobProvider(connection.host, connection.port, {
        accountName: connection.host,
        accountKey: connection.credentials.accountKey,
        connectionString: connection.credentials.connectionString,
        container: connection.credentials.container,
      });
    case "local":
      return new LocalProvider(connection.host);
    default:
      throw new Error(`Unsupported protocol: ${connection.protocol}`);
  }
}
