## Hook Submission

**Hook name:**
**Hook type:** [ ] Webhook &nbsp; [ ] Email &nbsp; [ ] Shell
**Tags** (comma-separated):

### What does this hook do?

<!-- Describe the hook's purpose, when to use it, and any side effects. -->

### Required setup

<!-- List any accounts, services, app passwords, or one-time setup steps the user must complete before importing this hook. -->

### Checklist

- [ ] Tested against a real FileBridge job run (pre-job or post-job trigger)
- [ ] All user-specific values (URLs, passwords, hostnames) use `inputs` — no hardcoded values
- [ ] `type: secret` used for passwords and API tokens
- [ ] Filename is `kebab-case.yaml` placed under `hooks-library/community/`
- [ ] YAML validates cleanly: `python3 -c "import yaml,sys; yaml.safe_load(sys.stdin)" < hooks-library/community/my-hook.yaml`
- [ ] `description` explains what the hook does and any required setup
- [ ] `author` field is set to your GitHub username or `"FileBridge Community"`
- [ ] Runtime variables (`{{job_name}}`, `{{status}}`, etc.) are **not** listed in `inputs`
