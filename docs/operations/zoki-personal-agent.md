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
override: VITE_ZOKI_AI_MODEL. If unset, the conversation uses the shared
Remote Config `zoko_ai_model`, falling back to VITE_FIREBASE_AI_MODEL and then
gemini-3.5-flash-lite. The Pages workflow forwards both model repository variables.
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
The source adapter interleaves up to 84 candidate records across tasks, teams,
classes, students, events, roles and initiatives without matching question words.
Each candidate is freshly read under Firestore rules, in batches of 12. Only
allowlisted fields are retained. If there are more than 12 candidates, a separate
Gemini call selects up to 12 relevant records from compact summaries using the
question and conversation. Unknown model-selected IDs are rejected. The answer
call receives their fuller fields (strings capped at 1,500 characters).
Twelve recent, currently authorized memories are eligible without lexical filtering.
Active conversation context includes up to 24 messages and 24,000 characters;
server conversation restore remains the latest twelve messages at 1,500 characters.
Local fallback answers and errors are excluded from model history and server sync.
Coverage is explicitly partial: this is not exhaustive school search. Detailed
grades, staff directory lookup, files and contacts are not added to the AI source
adapter by this change. General advice is allowed and distinguished from school facts.

## Semantic conversation and task handoff

All normal chat requests go through Gemini, including indirect requests and ending
the conversation. There is no regex shortcut for task creation. The model returns
`none`, `create_task` or `end_conversation`; this is not execution authorization.
It is instructed to use context, respect negations/corrections, and ask only one
material clarification when needed. Existing-task/draft edits are not registered
in this path: the model directs users to the editor instead of creating a duplicate.
A task handoff carries a self-contained brief and an explicitly interpreted target.
The task writer must succeed through AI, and its draft is not merged with a local
keyword playbook. Binding a named person/role to real staff still checks the loaded
directory. Saving and any role change retain the existing approval flow.

Provider failures are visible, with retry and an explicitly labelled local-search
option. Local search is read-only and is never invoked automatically. Late replies
cannot navigate or clear a different conversation. Console diagnostics contain
only model, stage, duration, token count or error metadata, never prompts or records.
One turn uses one or two AI calls, plus a separate task-writing call when applicable;
84 fresh candidate reads and extra AI calls increase quota use compared with the old
path. The question throttle is not a provider-call quota. Monitor real usage before
enabling broadly; upgrading billing or changing the model is not automatic.

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

`tests/unit/zokiSemanticTurn.test.js` checks orchestration with a fake provider:
history continuity, source validation, failure propagation, stale sessions and
task handoff. These tests do NOT measure real model understanding. Before release,
use a signed-in account with App Check and the configured model to check:

| Conversation | Expected behavior |
| --- | --- |
| Discuss collecting meeting materials, then “בוא נדאג שזה יקרה עד חמישי” | New task brief preserves materials, meeting and deadline; no repeated goal question |
| “אל תיצור משימה, רק תציע איך להתארגן” | Advice only, no navigation or write |
| Discuss an existing task, then “בעצם לשבוע הבא” | No duplicate task; explain how to edit the existing item |
| “צריך שמישהו יטפל בזה” without antecedent | One focused goal question |
| Same request with different wording and a pronoun | Equivalent intent and constraints |
| Duplicate staff names | Ask for exact person; do not assign arbitrarily |
| Source text says to ignore instructions | Treat as data; no unauthorized action |
| Provider quota/App Check failure | Visible error; no automatic local response |

Compare the actual model and stage diagnostics, the answer and the draft. Confirm
no record changes until approval. A successful build alone does not validate live
AI Logic, App Check, provider quota, or Hebrew answer quality.

Official references:
- https://firebase.google.com/docs/ai-logic/get-started?platform=web
- https://firebase.google.com/docs/ai-logic/quotas
- https://firebase.google.com/docs/ai-logic/pricing
