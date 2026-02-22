import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent clickjacking — FileBridge should never be embedded in an iframe
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing away from the declared content type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak the full referrer URL to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features that FileBridge has no need for
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Force HTTPS for 1 year in production; includeSubDomains protects any sub-paths
  // (only sent over HTTPS so safe to include unconditionally — browsers ignore it over HTTP)
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // Restrictive CSP: same-origin for everything, allow inline styles/scripts that
  // Next.js needs, and the specific CDN domains used by shadcn/Radix fonts if any.
  // 'unsafe-inline' for style-src is required by Tailwind's runtime CSS injection.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed by Next.js dev mode; tighten in prod if desired
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "ssh2-sftp-client", "v9u-smb2"],
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
