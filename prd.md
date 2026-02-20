Product Requirements Document (PRD): FileBridge
1. Overview and Objective
The objective of this project is to build a robust, internal web application that schedules and automates file transfers between different storage protocols. The system is designed with a pluggable architecture, starting with SFTP and SMB shares, but built to easily accommodate future storage backends. It will be packaged as a lightweight, portable container optimized for deployment on Docker hosts or Kubernetes clusters, providing users with a modern interface to configure connections, define rules, and monitor jobs.

2. Scope
In Scope (MVP):

Core transfer engine with a modular interface for storage providers.

Plugins for SFTP and SMB protocols.

Job scheduling interface (Cron-based or UI-driven).

Configurable post-transfer actions (Delete, Retain, Move).

Comprehensive dashboard for status monitoring and data metrics.

Audit logging and automated notifications.

Fully containerized setup with a portable embedded database.

Out of Scope (Future Features):

Plugins for cloud storage providers (AWS S3, Azure Blob, Google Cloud Storage) — Architecture will support this, but implementation is deferred.

File content transformation or manipulation (e.g., encrypting/decrypting payloads).

3. Tech Stack Specification
Framework: Next.js 14+ with App Router

Language: TypeScript

Authentication: NextAuth.js (Auth.js) integrated with Azure AD for enterprise SSO

Database: SQLite (Portable, file-based, ideal for container volumes)

ORM: Prisma or Drizzle (for easy schema migrations)

Styling: Tailwind CSS

UI Components: shadcn/ui

State Management: TanStack Query (React Query)

API Client: Axios

Form Handling: React Hook Form (with Zod for schema validation)

Icons: Lucide React

Theme: next-themes (Dark/Light mode support)

4. Architectural & System Requirements
4.1. Storage Provider Interface (Modularity)
To ensure easy expansion, the backend will utilize an interface-based design (e.g., a StorageProvider interface).

Standardized Methods: Every backend module must implement a standard set of methods: connect(), listFiles(), downloadFile(), uploadFile(), deleteFile(), and moveFile().

Dynamic Loading: The core engine will interact only with the interface, completely agnostic to the underlying protocol. Adding a new backend (like S3) in the future will only require writing a new class that implements the StorageProvider interface.

4.2. Connection & Job Management
Agnostic Credentials: The database schema for credentials will use a flexible JSON field or key-value structure to store connection properties, as different protocols require different auth methods (e.g., SSH keys for SFTP, domain/NTLM for SMB).

Job Configuration: Users can select predefined connections, define source/destination paths, and set basic wildcard file filtering (e.g., *.csv).

Execution Engine: A lightweight, in-process task scheduler or simple Redis-less queue (e.g., a better-sqlite3 backed queue) to handle background tasks and prevent concurrent executions of the same job.

4.3. Dashboard & Analytics (The "Single Pane of Glass")
The application must feature a primary dashboard providing immediate operational visibility into the health and throughput of the transfer engine.

High-Level KPIs:

Total Files Transferred: Aggregated counts (Last 24 Hours, Last 7 Days, All-Time).

Total Data Volume: Human-readable metrics showing the amount of data moved (MB, GB, TB).

Success Rate: Percentage of successful job executions vs. failures.

Active Monitoring:

Live Job Status: Visual indicators showing jobs currently in progress, queued, or recently failed.

Recent Activity Feed: A scrolling or paginated list of the most recent individual file transfers with their source, destination, size, and timestamp.

Visualizations: Interactive charts (utilizing Recharts alongside shadcn/ui) displaying data transfer volume and job execution trends over time.

4.4. Audit Logging and Notifications
Audit Logs: Detailed, immutable logs stored in the SQLite database detailing every file touched—including exact timestamps, file names, file sizes, and the specific job/connection profile used.

Notifications: Configurable alerting mechanisms (e.g., Email via SMTP, Microsoft Teams Webhooks) triggered on job failures, consecutive errors, or system-level issues.

5. Infrastructure & Deployment Strategy
The application will be designed as a "batteries-included," single-container deployment to maintain operational simplicity across environments.

Containerization: The Next.js web server, the background worker, and the SQLite database will run within a single Docker image, orchestrated via a process manager inside the container.

Storage & Persistence: State will be maintained entirely in the SQLite database file. Persistent data will be mapped to the container's /app/data directory via standard Docker bind mounts, local volumes, or Kubernetes Persistent Volume Claims (PVCs).

Upgrades & Migrations: Database schema migrations will automatically run during the container startup sequence to ensure smooth upgrades when pulling new image versions.

6. Success Metrics
Extensibility: A new storage backend can be implemented and integrated within a single sprint without altering the core transfer engine.

Portability: The container can be successfully deployed and spun up with intact state using a single docker run command or a basic K8s Deployment manifest.

Reliability: 99.9% success rate for configured, valid transfer jobs.