#!/usr/bin/env bash
# Starts auth+firestore emulators, seeds a demo school, and runs the beginner-teacher persona.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VITE_FIREBASE_API_KEY=demo-key VITE_FIREBASE_AUTH_DOMAIN=localhost VITE_FIREBASE_PROJECT_ID=demo-zoko-persona \
  VITE_FIREBASE_STORAGE_BUCKET=demo-zoko-persona.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=1 VITE_FIREBASE_APP_ID=1:1:web:1 \
  VITE_USE_FIREBASE_EMULATORS=true PERSONA_EMAIL=teacher@persona.test
# A fresh random password for the throw-away emulator accounts every run, so no credential is ever committed.
PERSONA_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
export PERSONA_PASSWORD
# The smoke flow needs the dev server (the beginner-teacher script starts its own when missing).
if [ -n "${PERSONA_SMOKE:-}" ] && ! curl -fs -o /dev/null http://localhost:5173/Zoko-Master/; then
  npx vite --port 5173 --strictPort >/dev/null 2>&1 &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -fs -o /dev/null http://localhost:5173/Zoko-Master/ && break; sleep 0.5; done
fi
if [ -n "${PERSONA_SMOKE:-}" ]; then
  RUN_CMD="node tests/persona/smoke-flow.mjs"
else
  RUN_CMD="node tests/persona/beginner-teacher.mjs --routes ${PERSONA_ROUTES:-/,/tasks,/calendar,/files,/staff,/students,/settings}"
fi
CONFIG_ARGS=()
if [ "${PERSONA_OPEN_RULES:-}" = "1" ]; then
  # Diagnostic mode: permissive Firestore rules, to tell rule problems apart from UI problems.
  TMP="$(mktemp -d)"
  printf "rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{p=**} { allow read, write: if true; } } }" > "$TMP/open.rules"
  printf '{"firestore":{"rules":"open.rules"},"emulators":{"auth":{"port":9099},"firestore":{"port":8080}}}' > "$TMP/firebase.json"
  CONFIG_ARGS=(--config "$TMP/firebase.json")
fi
npx firebase emulators:exec "${CONFIG_ARGS[@]}" --only auth,firestore --project demo-zoko-persona \
  "node scripts/persona/seed.mjs && $RUN_CMD"
