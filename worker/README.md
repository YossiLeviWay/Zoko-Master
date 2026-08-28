# Zoko institutional task-agent worker

This Worker is the security boundary between the public GitHub Pages client,
Gemini, Firestore's temporary learning inbox, and each school's private GitHub
knowledge repository. The canonical knowledge source is `school-brain.md` in a
private repository; Firestore holds only review sources that expire after 30
days.

Copy `wrangler.toml.example` to `wrangler.toml`, create a least-privilege GitHub
App with Contents read/write access only to the private knowledge repositories,
set the listed secrets, and deploy with Wrangler. Never commit `wrangler.toml`,
private keys, API keys, or repository mappings.

Set `FIREBASE_PROJECT_NUMBER` to require Firebase App Check on every protected
route. Set `FIREBASE_APP_IDS` to a comma-separated allowlist of the permitted
web app IDs. The Worker verifies the RS256 signature, issuer, expiry, audience
and optional app ID against Firebase's rotating public keys.

The daily cron removes temporary learning sources older than 30 days. It needs a
Firebase service-account email and private key stored as Worker secrets; the key
is never available to the browser and the account should be restricted to the
temporary inbox collections.
