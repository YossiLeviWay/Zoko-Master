# Security operations runbook

## Environment separation

- Create a dedicated Firebase staging project with separate Authentication, Firestore, Storage, Functions, App Check, billing, and IAM. Never point staging at the production project ID.
- Store staging and production Web client values in their hosting provider's encrypted environment settings. Store Functions secrets with Firebase Secret Manager or Google Cloud Secret Manager, never in source control.
- Use least-privilege service accounts. The one-time global-admin bootstrap credential stays outside the repository and should be revoked or disabled when bootstrap is complete.
- Register separate App Check Web apps and reCAPTCHA Enterprise keys for staging and production. Add localhost only to the staging/debug process; never commit App Check debug tokens.

## Backup and recovery

1. Before any Rules, Functions, or data migration production change, create a managed Firestore export to a dedicated, access-controlled backup bucket in the same compliance boundary.
2. Record only the export operation ID, project, time, and aggregate counts in the change ticket. Do not copy student records into tickets or logs.
3. Test restoration into an isolated staging project at least quarterly. Verify aggregate collection counts, sample authorization paths with synthetic accounts, and Storage object counts.
4. Keep daily backups for 30 days and monthly backups for 12 months unless the institution's approved retention policy requires a shorter period. Legal/privacy requirements override this default.
5. Recovery requires two-person approval, a new isolated target project, audit logging, and validation before DNS or hosting is switched.

## Immediate offboarding

1. Disable the employee in Firebase Authentication and revoke all refresh tokens.
2. Set the Firestore user document `accountStatus` to `disabled` through an approved server administration process.
3. Remove all school memberships, teams, custom roles, and pending invitations through Cloud Functions.
4. Rotate any non-personal integration credentials the employee could access.
5. Review `auditLogs`, Authentication activity, and blocked access attempts for the relevant period without exporting personal data to unsecured systems.
6. Transfer ownership of operational resources; retain or delete the former employee's profile only under the approved retention policy.

## Required production rollout order

1. Create and verify a backup.
2. Create the separate staging project.
3. Deploy Cloud Functions to staging.
4. Deploy Firestore and Storage Rules to staging.
5. Run lint, build, Functions tests, Rules tests, Storage tests, and the secret scan.
6. Run migration scripts in dry-run mode only.
7. Verify counts and authorization with synthetic viewer, editor, principal, and global-admin accounts from two schools.
8. Update the client in staging and verify existing workflows.
9. Obtain explicit production approval.
10. Deploy Functions and Rules to production.
11. Deploy the client.
12. Rotate the exposed administrator credential, revoke refresh tokens, and apply the approved custom claim.
13. Run only the specifically approved migration with execution guards.
14. Monitor errors, audit events, App Check metrics, and denied access attempts.

## Manual actions still required

1. Change the existing administrator account password immediately.
2. Revoke all refresh tokens for that account.
3. Review Firebase Authentication users, sign-in activity, audit logs, and suspicious access.
4. Locate every document containing `_authPassword` or `_pendingPassword` using an approved dry-run.
5. Create a Firestore backup before changing those documents.
6. Run the approved password-field cleanup only after reviewing its counts.
7. Register and enforce App Check for each environment after monitoring metrics.
8. Create and configure the separate staging project.
9. Prepare a short-lived local bootstrap service account outside the repository, then disable it.
10. Configure Functions secrets through Firebase or Google Cloud Secret Manager.

None of these manual actions, deployments, bootstrap commands, or migrations were executed by this branch.
