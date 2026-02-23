# Docker Deployment

FileBridge is configured for Next.js **standalone output**, producing a self-contained build that includes only the files needed to run — no `node_modules` required at runtime.

---

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Required for SMB/CIFS NTLMv2 support (MD4 hash via OpenSSL legacy provider)
ENV NODE_OPTIONS=--openssl-legacy-provider

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create the data directory for SQLite
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]
```

---

## Docker Compose

### Minimal

```yaml
version: "3.8"

services:
  filebridge:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - filebridge-data:/app/data
    environment:
      - NODE_OPTIONS=--openssl-legacy-provider
    env_file:
      - .env.production

volumes:
  filebridge-data:
```

### With Explicit Env Vars

```yaml
version: "3.8"

services:
  filebridge:
    image: your-registry/filebridge:latest
    ports:
      - "3000:3000"
    volumes:
      - filebridge-data:/app/data
    environment:
      NODE_OPTIONS: "--openssl-legacy-provider"
      NODE_ENV: "production"
      AUTH_SECRET: "${AUTH_SECRET}"
      NEXTAUTH_URL: "https://filebridge.example.com"
      AZURE_AD_CLIENT_ID: "${AZURE_AD_CLIENT_ID}"
      AZURE_AD_CLIENT_SECRET: "${AZURE_AD_CLIENT_SECRET}"
      AZURE_AD_TENANT_ID: "${AZURE_AD_TENANT_ID}"
      DATABASE_PATH: "/app/data/filebridge.db"
      LOG_LEVEL: "info"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    restart: unless-stopped

volumes:
  filebridge-data:
    driver: local
```

---

## Environment File for Production

Create a `.env.production` file (never commit this to git):

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://filebridge.example.com

AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Optional access control
ALLOWED_GROUP_IDS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

DATABASE_PATH=/app/data/filebridge.db
LOG_LEVEL=info
```

---

## Build and Run

```bash
# Build the image
docker build -t filebridge:latest .

# Run with env file
docker run -d \
  --name filebridge \
  -p 3000:3000 \
  -v filebridge-data:/app/data \
  --env-file .env.production \
  --restart unless-stopped \
  filebridge:latest

# View logs
docker logs -f filebridge

# Health check
curl http://localhost:3000/api/health
```

---

## Volume Mounts

| Path | Purpose |
|---|---|
| `/app/data` | SQLite database (`filebridge.db`) and backup files |

Mount this volume to a persistent storage location. If the volume is lost, all jobs, connections, settings, and logs are lost. Use the [backup system](Database-Backups) to protect against this.

### Separate Backup Volume (Recommended)

```yaml
volumes:
  - filebridge-db:/app/data          # Database file only
  - filebridge-backups:/app/backups  # Backup files on separate storage
```

Then configure the backup path in **Settings → Database Backups** to `/app/backups`.

---

## Reverse Proxy

FileBridge should run behind a reverse proxy (nginx, Caddy, Traefik) for TLS termination in production.

### nginx Example

```nginx
server {
    listen 443 ssl http2;
    server_name filebridge.example.com;

    ssl_certificate     /etc/ssl/certs/filebridge.crt;
    ssl_certificate_key /etc/ssl/private/filebridge.key;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name filebridge.example.com;
    return 301 https://$host$request_uri;
}
```

> **Important**: Pass `X-Forwarded-For` and `X-Real-IP` headers so FileBridge can log accurate client IP addresses in the audit trail.

### Caddy Example

```caddyfile
filebridge.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS automatically via Let's Encrypt.

---

## Resource Requirements

FileBridge is lightweight. Typical resource usage:

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 0.25 vCPU | 1 vCPU |
| Memory | 256 MB | 512 MB |
| Disk (app) | 200 MB | 200 MB |
| Disk (data) | 50 MB + logs | 1–5 GB |

Memory usage spikes temporarily while files are in transit, as files are buffered in memory during download/upload. For large files (100MB+), size your container accordingly or use streaming transfers (planned feature).

---

## Updating

```bash
# Pull latest code
git pull

# Rebuild image
docker build -t filebridge:latest .

# Recreate container (zero-downtime if behind a load balancer)
docker stop filebridge
docker rm filebridge
docker run -d \
  --name filebridge \
  -p 3000:3000 \
  -v filebridge-data:/app/data \
  --env-file .env.production \
  --restart unless-stopped \
  filebridge:latest
```

The database schema auto-migrates on startup — no manual migration step is needed.

---

## Multi-Stage Build Notes

The Dockerfile uses a two-stage build:

1. **Builder stage**: Installs all dependencies (including `devDependencies`) and compiles the Next.js app
2. **Runner stage**: Copies only the standalone build output — no source code, no dev dependencies, no `node_modules` (except those bundled by Next.js standalone)

The standalone output is produced by the `output: "standalone"` setting in `next.config.ts`.

---

## Important: NODE_OPTIONS

The `NODE_OPTIONS=--openssl-legacy-provider` environment variable **must** be set in the container for SMB/CIFS connections to work. NTLM authentication requires the MD4 hash algorithm, which was removed from OpenSSL 3.x (used by Node.js 17+). The legacy provider re-enables it.

Without this variable, all SMB operations will fail with a cryptographic error. SFTP and Azure Blob Storage are not affected.
