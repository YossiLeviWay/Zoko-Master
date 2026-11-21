# Moving the site to Firebase Hosting (free Spark plan)

The app already uses Firebase (Auth, Firestore, Storage). Hosting the site there as well lets the GitHub repository be
private: GitHub Pages cannot serve a private repository on a free account. Firebase Hosting also applies the security
headers in `firebase.json` (CSP, `X-Frame-Options`), which GitHub Pages cannot.

The workflow `.github/workflows/deploy-firebase.yml` publishes the site on every push to `main`. It stays idle until
steps 1 and 2 are done, so merging it first is safe.

## One-time setup (owner)
1. **Service account for deployment.** Google Cloud Console → the Firebase project → IAM & Admin → Service accounts →
   Create. Roles: *Firebase Hosting Admin* and *API Keys Viewer*. Open it → Keys → Add key → JSON.
   GitHub → repository Settings → Secrets and variables → Actions → **New secret** `FIREBASE_SERVICE_ACCOUNT`
   with the whole JSON. Never commit this file or paste it in a chat.
2. **Project id.** Same page, tab *Variables* → New variable `FIREBASE_PROJECT_ID` with the Firebase project id.
   Also add the variable `VITE_ZOKI_WORKER_URL` once the Claude worker exists.
3. **Authorized domain.** Firebase Console → Authentication → Settings → Authorized domains → add
   `<project-id>.web.app` (and `.firebaseapp.com` if it is not there).
4. **Worker origins.** In the Cloudflare Worker set `ALLOWED_ORIGINS` to include `https://<project-id>.web.app`.
5. **App Check** (if enabled): add the new domain to the reCAPTCHA site key's allowed domains.
6. Run the workflow once (Actions → Deploy to Firebase Hosting → Run workflow), open `https://<project-id>.web.app`,
   log in, and check a few screens.

## After the site works
- Turn off the GitHub Pages workflow (`.github/workflows/deploy.yml`): Actions → it → ⋯ → Disable workflow.
- Then the repository can be made private (Settings → Danger Zone → Change visibility).

## Notes
- Hosting only. Firestore/Storage rules and functions are deployed separately and in the staged order of
  `docs/security/operations.md`.
- The free plan has hosting storage and transfer limits that are ample for one school; functions are not available on it.
