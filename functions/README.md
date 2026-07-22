# Zoko-Master Cloud Functions

Firebase Functions v2 running on Node.js 20. These functions are the only supported path for privileged user, role, membership, and team-membership changes.

## Security properties

- Callable authentication is required.
- App Check enforcement is enabled on every callable.
- `global_admin` is accepted only from a verified ID-token custom claim.
- Principal authorization is resolved from the server-side user document and verified school membership.
- Inputs use strict schemas; unknown fields and password fields are rejected.
- Sensitive operations are rate-limited and written to `auditLogs` with server timestamps.
- Error responses are generic and logs do not include request bodies, email addresses, credentials, tokens, or profile data.

## Local checks

```bash
npm ci
npm run lint
npm test
```

Use the Firebase Emulator Suite for integration tests. Do not run Admin scripts or deploy Functions merely to test local code.

## Deployment

Deployment is intentionally not automated from a developer workstation. Follow `docs/security/operations.md` and deploy to the approved staging project first. Production deployment requires an explicit approval after backups, emulator tests, staging verification, and a migration dry run.
