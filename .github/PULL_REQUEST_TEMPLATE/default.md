## Related Issue

Closes #

## Description

What does this PR change and why?

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation
- [ ] Chore / refactor

## Testing

Describe how you tested this change:

- Deployment method used (Docker / native / dev)
- Storage protocol(s) exercised (SFTP / SMB / Azure Blob / Local)
- Steps taken to verify the change works as expected

## Checklist

- [ ] `npm run lint` passes with no errors
- [ ] No secrets or credentials are committed
- [ ] If schema changed: migration added to `lib/db/index.ts` startup block
- [ ] If new storage provider: implements `StorageProvider` interface and added to `serverExternalPackages` in `next.config.ts`
- [ ] README or wiki updated if this is a user-facing change
