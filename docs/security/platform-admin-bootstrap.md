# Platform Admin bootstrap and MFA

Platform Admin is a support identity, not a school-wide superuser. Its `platform_admin` custom claim is assigned only with Firebase Admin SDK. Firestore and Storage rules deliberately deny this identity access to students, grades, attendance, school files, tasks, calendars, conversations, personal files, CVs and individual outcome results.

## Before running anything

1. Use a dedicated Firebase Auth account with no shared password.
2. Enable a supported second factor for the account in Firebase Authentication and require the operator to enroll it.
3. Keep the service-account JSON outside this repository and point `GOOGLE_APPLICATION_CREDENTIALS` to it locally.
4. Test on staging first and obtain explicit production approval.

The command is dry-run by default:

```bash
node functions/scripts/bootstrap-platform-admin.js --uid EXPLICIT_UID --project STAGING_PROJECT_ID
```

After reviewing the target UID and project, an approved execution is:

```bash
node functions/scripts/bootstrap-platform-admin.js --uid EXPLICIT_UID --project STAGING_PROJECT_ID --execute --acknowledge-production-risk
```

The script preserves unrelated custom claims, records a platform audit entry and never reads or prints credentials. After assignment, revoke old refresh tokens and sign in again with MFA so the client receives a fresh ID token. Sensitive support actions also require a recent MFA authentication time (ten minutes).

## Signing in

There is no separate or shared Platform Admin password. Sign in through the regular email/password screen with the dedicated Firebase Authentication account. A Platform Admin may leave the school selection empty; after a fresh token contains the `platform_admin` claim, the application routes the account to `/platform`. A school user must instead choose one of the schools listed in their own `users/{uid}` membership data after authentication.

Never add an email-based bypass or expose a bootstrap credential in the client. If the Platform Admin route is unavailable after bootstrap, revoke the account's refresh tokens, sign out, sign in again with MFA and verify the custom claim outside the browser.

## Deployment order

Deploy security-sensitive changes to staging first and run the emulator and acceptance tests before production. The Spark forum access workflow is an explicit exception to the server-only administration model: a school principal creates a narrowly validated request directly in Firestore, and only a signed-in identity with the `platform_admin` custom claim can approve it and create the matching membership in one atomic batch. Forum attachments remain disabled on Spark. School creation, Auth user provisioning, custom-claim assignment, graduation, outcomes and support administration remain server or manual-console operations and must never be moved into an unrestricted browser workflow.

The repository does not deploy Cloud Functions on Spark and does not require a billing account for forum messages or forum access approval. Do not enable the school-provisioning buttons unless the matching secured backend has been deployed intentionally; for a demonstration environment, create the Auth account and school records through an approved manual administration procedure instead.
