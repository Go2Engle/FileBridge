import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "ssh2-sftp-client", "@marsaud/smb2"],
};

export default nextConfig;
