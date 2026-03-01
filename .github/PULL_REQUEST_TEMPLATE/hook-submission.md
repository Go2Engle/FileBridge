## Hook Submission

**Hook name:**
**Hook type:** [ ] Webhook &nbsp; [ ] Shell
**Tags** (comma-separated):

### What does this hook do?

<!-- Describe the hook's purpose, when to use it, and any side effects. -->

### Required environment variables or setup steps

<!-- List any env vars (e.g. SLACK_WEBHOOK_URL), external services, or one-time setup the user must do before using this hook. -->

### Checklist

- [ ] Tested against a real FileBridge job run (pre-job or post-job)
- [ ] Uses `{{PLACEHOLDER}}` syntax for secrets/URLs — no hardcoded values
- [ ] Filename is `kebab-case.yaml` placed under `hooks-library/community/`
- [ ] YAML is valid (`python3 -c "import yaml,sys; yaml.safe_load(sys.stdin)" < hooks-library/community/my-hook.yaml`)
- [ ] Description in the YAML file explains required env vars or setup
- [ ] `author` field is set to your GitHub username or "FileBridge Community"
