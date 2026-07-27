# Official holiday calendar import

The application contains a reviewed, source-attributed template for `year_2026_2027`. The UI merges that template with each school's local records, so the calendar is visible without writing to Firestore and local overrides are never silently replaced.

The Admin SDK importer is optional and is dry-run by default. It reads counts only, does not print holiday or user data, never deletes documents, does not alter other academic years, and preserves an existing local record with the same name and start date.

Dry-run (staging first):

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repository.json \
  npm --prefix functions run import:official-holidays -- \
  --project STAGING_PROJECT_ID \
  --school EXPLICIT_SCHOOL_ID \
  --academic-year year_2026_2027
```

Writing requires all explicit approval guards and a verified backup:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repository.json \
  npm --prefix functions run import:official-holidays -- \
  --project APPROVED_PROJECT_ID \
  --school EXPLICIT_SCHOOL_ID \
  --academic-year year_2026_2027 \
  --execute \
  --approved-project APPROVED_PROJECT_ID \
  --backup-complete \
  --approval-reference APPROVAL_TICKET
```

Do not run `--execute` against production until the dry-run report, source links, record counts, backup, and target project have been reviewed and the owner has explicitly approved the import.
