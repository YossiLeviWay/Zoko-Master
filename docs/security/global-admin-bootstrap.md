# First global administrator bootstrap

This script is intentionally local-only and was not executed during hardening.

## Prerequisites

1. Receive explicit approval for the exact Firebase project and UID.
2. Create or select a least-privilege local Google credential outside this repository.
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to that external file. Never copy the credential into this repository.
4. Confirm the target UID in Firebase Authentication and confirm the project is staging unless production was explicitly approved.
5. Back up the affected user document and record the change ticket/approver.

## Dry run (default)

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/secure/outside/repo/credential.json \
  node scripts/bootstrap-global-admin.js --uid EXACT_FIREBASE_UID --project STAGING_PROJECT_ID
```

The default command validates arguments and exits without initializing Firebase Admin or changing data.

## Approved execution

Only after explicit approval:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/secure/outside/repo/credential.json \
  node scripts/bootstrap-global-admin.js \
  --uid EXACT_FIREBASE_UID \
  --project APPROVED_PROJECT_ID \
  --execute \
  --acknowledge-production-risk
```

The script preserves existing custom claims, adds only `global_admin: true`, updates the matching user document, and records an audit entry. The user must obtain a fresh ID token before the claim appears. Revoke old sessions when replacing a compromised administrator credential.

## Restrictions

- Do not run against production as part of deployment automation.
- Do not accept an email address; resolve and verify the exact UID manually.
- Do not print ID tokens, custom-token values, credentials, or user profile data.
- Do not commit service-account JSON or shell history containing credential paths.
