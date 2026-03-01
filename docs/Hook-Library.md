# Hook Library

The Hook Library is a built-in browser for pre-built hook templates. Instead of configuring a hook from scratch, you can browse, configure, and import a template in a few clicks.

---

## Opening the Library

1. Navigate to **Settings → Hooks**
2. Click **Browse Library**

The library dialog lists all available templates from two sources.

---

## Template Sources

### Community Templates

Community templates are fetched directly from the FileBridge GitHub repository (`hooks-library/community/` on the `main` branch). They are cached for 5 minutes so the library loads quickly on repeat visits.

Community templates cover common integration patterns — Slack, Teams, Discord, email notification, and more. Anyone can [submit a template](Hook-Template-Authoring#submitting-to-the-community) via pull request.

If GitHub is unreachable, the library falls back to the last successful fetch.

### Local Templates

Local templates are YAML files you place in `hooks-library/local/` inside your FileBridge install directory. They are read from disk on every library request — no caching.

Use local templates for:
- Organisation-specific hooks you don't want to publish publicly
- Templates under development before submitting to the community
- Site-specific integrations (internal APIs, ticketing systems, etc.)

The **Local** source filter and badge only appear when at least one local template exists.

---

## Browsing and Filtering

The library supports:

- **Search** — matches against name, description, and tags
- **Type filter** — Webhook, Email, or Shell
- **Source filter** — Community or Local (visible only when local templates exist)

---

## Importing a Template

### Direct Import (no configuration required)

Templates with no user-configurable inputs import immediately when you click **Import**. The hook appears in your hooks list, enabled by default.

### Configure & Import (inputs required)

Templates that require configuration (SMTP credentials, webhook URLs, API keys, etc.) show a **Configure & Import** button. Clicking it opens a form:

1. Fill in all required fields (marked with `*`)
2. Secret fields (passwords, tokens) show a password mask by default — click the eye icon to reveal the value while typing
3. Click **Import**

FileBridge substitutes your values into the template's config placeholders and saves the resulting hook. The original template is not modified.

> **Already imported?** If a hook with the same name already exists in your list, the button shows **Imported** and is disabled. Edit the existing hook directly from the hooks list if you need to update its configuration.

---

## What Importing Creates

Importing a template creates a **copy** of that template as a live hook in your hooks list. It behaves identically to a hook you created manually:

- You can edit it at any time
- You can attach it to jobs
- It is encrypted at rest like all other hooks
- Deleting the template file does not affect an already-imported hook

---

## Adding Local Templates

1. Create a YAML file following the [template format](Hook-Template-Authoring)
2. Place it in `hooks-library/local/` inside your FileBridge install directory:

   ```
   /opt/filebridge/hooks-library/local/my-hook.yaml
   ```

3. Open the Hook Library — it appears immediately (no restart required)

The `hooks-library/local/` directory is not created by default; create it manually if it doesn't exist.

> **Docker installs:** Mount `hooks-library/local/` as a volume so your local templates survive container updates:
>
> ```yaml
> volumes:
>   - ./local-hooks:/app/hooks-library/local
> ```

---

## GitHub API Rate Limits

Community templates are fetched from the GitHub API. Unauthenticated requests are limited to 60 per hour per IP address, shared across all users of the same IP.

To increase the limit to 5,000 requests/hour, set a GitHub personal access token (no scopes required for public repos):

```env
GITHUB_TOKEN=ghp_...
```

The token is used only for GitHub API requests and is never exposed to the browser.
