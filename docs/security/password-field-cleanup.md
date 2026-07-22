# Password field cleanup

`functions/scripts/remove-password-fields.js` scans only the `users` collection for the legacy `_authPassword` and `_pendingPassword` fields. It never prints document IDs, email addresses, field values, or personal data.

The script is dry-run by default and was not run while preparing this hardening branch:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repo.json \
  npm --prefix functions run security:remove-password-fields -- \
  --project your-staging-project
```

Writing is deliberately protected by two flags:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repo.json \
  npm --prefix functions run security:remove-password-fields -- \
  --project your-staging-project --execute --confirm-production
```

Do not use `--execute` until a Firestore backup exists, the dry-run count has been reviewed, the target project has been verified, and the owner has explicitly approved the operation. The update is idempotent and deletes only the two legacy fields; it does not delete user documents or Auth accounts.
