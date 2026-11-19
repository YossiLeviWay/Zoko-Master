#!/usr/bin/env bash
# Starts auth+firestore emulators, seeds a demo school, and runs the beginner-teacher persona.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VITE_FIREBASE_API_KEY=demo-key VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_PROJECT_ID=demo-zoko-persona \
  VITE_FIREBASE_STORAGE_BUCKET=demo-zoko-persona.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=1 VITE_FIREBASE_APP_ID=1:1:web:1 \
  VITE_USE_FIREBASE_EMULATORS=true PERSONA_EMAIL=teacher@persona.test PERSONA_PASSWORD=Persona-Test-1234
CONFIG_ARGS=()
if [ "${PERSONA_OPEN_RULES:-}" = "1" ]; then
  # Diagnostic mode: permissive Firestore rules, to tell rule problems apart from UI problems.
  TMP="$(mktemp -d)"
  printf "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{p=**} { allow read, write: if true; } } }" > "$TMP/open.rules"
  printf '{"firestore":{"rules":"open.rules"},"emulators":{"auth":{"port":9099},"firestore":{"port":8080}}}' > "$TMP/firebase.json"
  CONFIG_ARGS=(--config "$TMP/firebase.json")
fi
npx firebase emulators:exec "${CONFIG_ARGS[@]}" --only auth,firestore --project demo-zoko-persona \
  "node scripts/persona/seed.mjs && ${PERSONA_SMOKE:+node tests/persona/smoke-flow.mjs}${PERSONA_SMOKE:-node tests/persona/beginner-teacher.mjs --routes ${PERSONA_ROUTES:-/,/tasks,/calendar,/files,/staff,/students,/settings}}"
