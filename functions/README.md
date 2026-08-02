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

## Communication drafting agent

`draftCommunicationWithAgent` is an optional server-only callable. It requires Firebase Auth, App Check, an active school membership and the `communications.useAgent` permission. The model receives only the bounded context, approved contact fields and same-school assignee labels selected by the server. It cannot send mail, create a follow-up or write a draft; the user must explicitly apply the proposal and then use the existing manual confirmation flow.

Configure `OPENAI_API_KEY` only as a Functions secret and optionally set `OPENAI_COMMUNICATION_MODEL` as a server parameter. Never expose either value through a `VITE_` variable or commit it. If the secret or callable is unavailable, the client fails closed and manual drafting remains usable. Enabling this callable requires an intentionally deployed backend and the applicable Firebase/OpenAI billing; a GitHub Pages deployment alone does not activate it.

The current Spark-plan demo client does not call this function. It uses Firebase AI Logic with the Gemini Developer API and sends only the text explicitly entered in the agent panel. This server callable remains available for a future paid deployment that needs server-enforced role checks, approved contacts, assignee resolution and audit logging.

## Deployment

Deployment is intentionally not automated from a developer workstation. Follow `docs/security/operations.md` and deploy to the approved staging project first. Production deployment requires an explicit approval after backups, emulator tests, staging verification, and a migration dry run.
