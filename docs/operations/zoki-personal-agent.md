# Zoki personal agent — Firebase Spark + Firebase AI Logic

Zoki uses Firebase Authentication, Firestore, App Check and Firebase AI Logic
with the Gemini Developer API. No Cloudflare account, Worker, separate backend,
Gemini key file or service-account key is required for personal conversations.
The provider boundary is FirebaseGeminiProvider.generateTurn(input), which returns
an answer, authorized citation IDs and at most three memory changes.

## Activation

1. In the existing Firebase project's Firebase AI Logic page, choose Get started
   and the Gemini Developer API. Keep the project on Spark for free-tier usage.
   Do not select the paid Agent Platform/Vertex AI provider.
2. Configure/enforce App Check for the web app. Set the existing
   VITE_FIREBASE_APPCHECK_SITE_KEY build secret to its reCAPTCHA Enterprise site key.
   Local development requires the supported App Check development setup as well.
3. In Google Cloud's Firebase AI Logic API quotas, reduce the per-user generate
   content limit from its default to the desired common limit (suggested: 4/min).
   This quota is uniform for all users of the project, not per school. Gemini's
   project/model quotas also apply. No application setting can raise those quotas.
4. Deploy the Firestore rules and rebuild/deploy the web app. Optional model
override: VITE_ZOKI_AI_MODEL, default gemini-3.5-flash-lite.
5. Verify a real signed-in teacher's answer, memory save/reload and quota error.
   A successful direct Gemini-key test does not verify AI Logic or App Check.

Personal Zoki does not use VITE_TASK_AGENT_WORKER_URL or VITE_ZOKI_WORKER_URL.
Legacy institutional-brain integrations are disabled in the frontend; task drafts
use the existing Firebase AI Logic service. The historical worker directory is
retained as pre-existing source, but is not part of this application path.
Existing Firebase callable actions elsewhere in the app are not migrated by this
change; personal AI conversations and memory do not require those callables.

## Memory and data access

- zokiAgents/{uid}: stable agent ID, learning toggle and one global preference text
  explicitly edited by its owner.
- zokiAgents/{uid}/scopes/{schoolId}: at most 100 compact memories, with up to three
  source paths each. Automatic memories are school-scoped. Facts/goals/follow-ups
  expire after 90 days; preferences persist. Expired entries are omitted from
  retrieval and discarded on the next write; no background cleanup is needed.
- zokiAgents/{uid}/conversations/{schoolId}: latest twelve messages, up to 1,500
  characters per message. Pending actions are not replayed on restore.

Only the owner can read agent documents; school scopes additionally require
current school membership. Sources are fetched with getDocFromServer, so current
Firestore rules authorize access and stale offline data is not used as evidence.
The context selects at most 12 source records, six relevant memories and six
recent messages. Unrelated learned facts are omitted while durable preferences,
goals and follow-ups remain eligible. Field and message lengths are bounded. It is not an
exhaustive search of all school records. Detailed grades and file extraction
remain outside this initial source adapter.

Memory updates use Firestore transactions to preserve concurrent edits and honor
learning being paused during generation. A failed memory write does not discard
the answer. The answer contains a save/failure indication. The settings dialog
supports paging, editing, deletion, clearing the current school memory, global
preferences and toggling automatic learning. No context snapshot or school data
copy is written per turn, and the transcript sync waits until generation ends.

## Rate limits

The school manager's questionsPerMinute setting (1–20, default 4) is a convenience
limit enforced in the browser, shared across tabs using Web Locks/localStorage
where available. It is NOT a tamper-proof spending limit and does not coordinate
multiple devices. The UI labels this explicitly. Enforcement against bypass is
Google's common AI Logic quota and the Gemini project's quota. Limiting requests
in this version does not write a Firestore counter for every question.

## Verification

Run npm run lint, npm run typecheck, npm run test:unit, npm run test:emulator,
and npm run build. Emulator tests cover owner isolation, school membership,
bounded memory and manager-only configuration. Live AI Logic activation still
requires the Firebase console settings above; no Gemini API key belongs in VITE_*.

Official references:
- https://firebase.google.com/docs/ai-logic/get-started?platform=web
- https://firebase.google.com/docs/ai-logic/quotas
- https://firebase.google.com/docs/ai-logic/pricing
