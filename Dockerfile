# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Base: shared Alpine + Node image
# NOTE: All stages must use the same base so native modules compiled in
#       'builder' (musl/Alpine) are binary-compatible in 'runner'.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS base

# -----------------------------------------------------------------------------
# deps: install ALL dependencies (including devDeps needed to compile native
#       modules like better-sqlite3 and ssh2-sftp-client).
# -----------------------------------------------------------------------------
FROM base AS deps
# libc6-compat: compatibility shim for some musl/glibc binaries
# python3 + make + g++: required to compile native Node add-ons (better-sqlite3, ssh2, v9u-smb2)
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# -----------------------------------------------------------------------------
# builder: compile the Next.js application
# -----------------------------------------------------------------------------
FROM base AS builder
# Only libc6-compat needed — native modules are already compiled in deps
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure public/ exists — Next.js requires it and the runner COPYs from it.
# The directory may be absent if the project has no static public assets yet.
RUN mkdir -p /app/public

# next.config.ts already sets output: "standalone", so the build produces a
# self-contained .next/standalone directory with only required node_modules.
RUN npm run build

# -----------------------------------------------------------------------------
# runner: minimal production image
# -----------------------------------------------------------------------------
FROM base AS runner

# openssl: required for the legacy provider (--openssl-legacy-provider) which
# v9u-smb2 needs for NTLM authentication (uses MD4, dropped in OpenSSL 3 defaults).
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV NODE_ENV=production
# Required at runtime by v9u-smb2 / NTLM auth (MD4 via OpenSSL legacy provider)
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Create the SQLite data directory and give nextjs user ownership
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy static public assets
COPY --from=builder /app/public ./public

# Copy the standalone build (includes its own node_modules with native binaries)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy Next.js static asset bundle (CSS, JS chunks, images)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Mount a host volume here for persistent SQLite storage across container restarts
VOLUME ["/app/data"]

# next/standalone entrypoint
CMD ["node", "server.js"]
