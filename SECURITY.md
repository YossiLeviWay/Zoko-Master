# Security

This project handles school data about students, staff and tasks. Treat the repository and every deployment as private.

- Report a vulnerability privately to the repository owner; do not open a public issue.
- Never commit keys, tokens or passwords. The Anthropic/Gemini/GitHub keys live only as Worker or GitHub Actions secrets.
- The Firebase web config in the client bundle is public by design; protection comes from Authentication, Firestore/Storage rules and App Check.
- Any credential that was ever committed must be rotated, even if it was later removed from the code.
