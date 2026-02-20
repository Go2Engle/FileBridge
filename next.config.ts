import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "ssh2-sftp-client", "v9u-smb2"],
};

export default nextConfig;
