# Handoff: where the work stands (2026-11-20)

Branch: `claude/school-management-zuki-agent-xsiatf` (PR #38 into `main`). Push every change to this branch right away;
do not push to `main` and do not merge without the owner's explicit request.

## Product goal (from the owner)
A school-management app (Hebrew, RTL) for a Labor Ministry vocational school. Roles come from the Ministry; staff get
role "tags" that grant permissions; only the institution manager appoints role holders. Zoki is the in-app agent:
one Zoki (no model switching, no Codex), with a sub-agent per role, reminders of tasks and dates, weekly summaries
(not built yet), answers based only on sourced knowledge. Events/tasks reach only the people they concern. Simple UX,
few menus and little text, high contrast, mobile friendly, and a beginner-teacher tester that reports problems.

## Done (all on the branch, 207 unit tests pass)
- Role catalog: `functions/src/schoolRoleCatalog.js` (22 roles, capability templates are OUR proposal), shown in
  `src/components/Access/AccessProfileEditor.jsx`. No role can appoint role holders (`MANAGER_ONLY`).
- Official role definitions parsed as data from the Ministry site: `functions/src/data/roleDefinitions.js` and
  `functions/src/roleDefinitions.js` (16 roles, 11 complete, 5 summary-only).
- Zoki knowledge layer: `functions/src/zokiKnowledge.js` (verified entries with source URL; unverified topics are
  deferred), role agent profiles `functions/src/roleAgents.js`, school-year calendar `functions/src/schoolYearCalendar.js`.
  Verified entries come from pedagogiamh.co.il pages and the Ministry of Education Bagrut circular (תשפ״ז).
- Dashboard: milestones widget ("מועדים חשובים"), event audience filtering (`functions/src/eventAudience.js`),
  event form section "למי זה רלוונטי?".
- Zoki chat window simplified (`src/components/Zoki/ZokiPage.jsx`), Codex removed entirely, Esc closes popups,
  right-click menus (`src/components/Common/ContextMenu.jsx`), version/commit/build time at the bottom of the screen.
- Navigation grouped (5 primary items + grouped "more"), accessibility fixes, mobile sidebar bug fixed.
- Attendance sheets: quick-mark bar, add student (creates student card + enrolment), links to student cards, missing-info
  triangle, orphan repair. All student creation syncs into the class attendance sheets from `createStudent`.
- Worker endpoint for Claude role agents: `worker/src/claude.js`, route `POST /v1/zoki/turn`; browser client
  `src/services/zokiClaudeService.js`. NOT connected to the chat UI yet and needs an API key (see below).
- Security: stored-XSS fix in document export, dependency updates, gitleaks in CI (history + tree), `SECURITY.md`,
  random emulator passwords. Firestore rules were NOT reviewed line by line.
- Tester: `tests/persona/beginner-teacher.mjs` and `smoke-flow.mjs`, run with `scripts/persona/run.sh`
  (`PERSONA_SMOKE=1 PERSONA_OPEN_RULES=1` for the end-to-end flow on emulators).

## Important gotchas
- When `VITE_SIMPLE_ACCESS_ENABLED` is not `true`, the build REPLACES 12 files with a legacy snapshot
  (`scripts/simple-access-legacy.json`): Sidebar, Students, FileManager, GanttChart, StaffManagement, usePermissions,
  RolesManager, ClassPermissionsManager, PagePermissionsPanel, PermissionsMenu, NavPermissionsPanel, GradeMappingEditor.
  Any change to those files must ALSO be applied to the snapshot (a test checks the Students page).
- Edit files with Python read-then-write in separate steps: `open(p,'w').write(f(open(p).read()))` truncates the file first.
- Fetch from the Ministry sites with plain requests only. `apps.education.gov.il` and `gov.il` are blocked; never spoof a
  browser. `meyda.education.gov.il` and `pedagogiamh.co.il` work.
- The repo is public until the owner changes it; GitHub Pages is the live host (still v1.32 until a deploy).

## Current status (late Nov 2026)
- **Hosting:** live on Firebase Hosting, `https://eduflow-pro-12a90.web.app`. Every merge to `main` deploys it through
  `.github/workflows/deploy-firebase.yml` (secret `FIREBASE_SERVICE_ACCOUNT`, variable `FIREBASE_PROJECT_ID`). GitHub Pages
  (`deploy.yml`) is still on; disable it and make the repo private once the owner is ready. App Check key `eduflow-web` now lists the new domain.
- **Zoki local model:** the chat goes browser -> Cloudflare Worker `zoko-task-agent` (`worker/`, deployed by hand with
  `wrangler deploy`; `worker/wrangler.toml` is untracked) -> Cloudflare quick tunnel -> `school-ai` service on the owner's Mac
  (DictaLM 3.0 on Ollama with its own RAG over `~/school-ai/knowledge`). Contract: POST `/api/chat`, header `x-api-key`,
  body `{message<=800, history<=6, stream}`, answer `{answer, sources}`; stream is SSE (`event: token`/`done`). Worker secrets:
  `LOCAL_MODEL_URL`, `LOCAL_MODEL_TOKEN`, Firebase ids; var `ZOKI_PROVIDER=local`. The site defaults `VITE_ZOKI_PROVIDER=worker`.
  Knowledge for the model comes from `npm run export:knowledge` (`docs/zoki-knowledge-export.md`), ingested by the Mac session.
  The tunnel URL changes when the Mac restarts: re-run `wrangler secret put LOCAL_MODEL_URL`. Prefer a named tunnel.
- **Bugs found and fixed this round:** App Check JWT signature was parsed as JSON in the Worker (`decodeJwtPart`), `functions/`
  dependencies missing in the Firebase workflow, CSP meta tag lacked `*.workers.dev`.
- **In progress:** answer streaming (merged), a fast small model with automatic escalation to the strong one on timeout (Mac session
  is measuring; Worker side to be written after the numbers). Answers currently take 30-75 s.
- **Known noise:** a callable at `europe-west1` (`zokiTaskGuidance`) fails CORS because Cloud Functions are not deployed on Spark.

## Next steps (suggested order)
1. Review Firestore rules (`firestore.rules`, `storage.rules`) for data leaks; 6 storage emulator tests fail (not caused by
   this work; check whether it is the emulator or the rules).
2. Connect `zokiClaudeService` to the chat window and show action proposals for approval.
3. Weekly summary and proactive reminders (needs the Worker cron and a key).
4. Staff `subjects` field so events can be routed by subject teacher.
5. Read the remaining ~40 pages of pedagogiamh.co.il (Bagrut/Gmar paths, exam calendar, social pillar) into the knowledge layer.
6. Attendance: flag students above 7 absences a month and prepare form 8.1.
7. More simplification of permission screens; continue beginner-teacher passes on more screens.

## Commands
`npm run test:unit` · `npm run build` · `npx eslint src worker tests` · `(cd functions && npx eslint src)` ·
`PERSONA_SMOKE=1 PERSONA_OPEN_RULES=1 ./scripts/persona/run.sh`
