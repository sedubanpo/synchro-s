# Synchro-S Firebase Migration Plan

This plan keeps Supabase schedules as the source of record while Firebase identity and permission data are introduced in parallel.

## Safety Principles

- Do not delete, truncate, recreate, or overwrite existing schedule data.
- Keep original Supabase name fields in `students`, `instructors`, `classes`, and `class_enrollments`.
- Add nullable Firebase reference fields first, then fill only exact non-duplicate matches.
- Treat duplicate names, ambiguous names, and unmatched rows as manual-review items.
- Keep existing Supabase authentication and schedule APIs active until Firebase access is fully verified.

## Added Supabase References

Apply `supabase/migrations/0010_firebase_identity_refs.sql` after taking a Supabase backup.

The migration only adds nullable reference/status fields:

- `users.firebase_uid`, `users.firebase_role`, `users.firebase_synced_at`
- `instructors.firebase_uid`, `instructors.firebase_instructor_id`, `instructors.firebase_match_key`, `instructors.firebase_sync_status`, `instructors.firebase_synced_at`
- `students.firebase_uid`, `students.firebase_student_id`, `students.firebase_match_key`, `students.firebase_sync_status`, `students.firebase_synced_at`
- `classes.firebase_instructor_id`, `classes.firebase_sync_status`, `classes.firebase_synced_at`
- `class_enrollments.firebase_student_id`, `class_enrollments.firebase_sync_status`, `class_enrollments.firebase_synced_at`
- `timetable_groups.firebase_target_id`, `timetable_groups.firebase_sync_status`, `timetable_groups.firebase_synced_at`

## Dry-Run Audit

Run the audit locally with read-only behavior first:

```bash
npm run audit:firebase-migration -- --include-details --output migration-reports/latest.json
```

For a complete report, set `SUPABASE_SERVICE_ROLE_KEY` in a secure local or CI environment. Without it, the script can inspect Google Sheets but cannot bypass Supabase RLS to read all schedule-linked rows.

The report separates:

- exact matches
- duplicate or ambiguous names
- unmatched Supabase students/instructors
- unmatched sheet students/instructors
- proposed Firestore seed documents
- proposed `studentPermissions`

## Reference Apply

After reviewing the report and applying the SQL migration, fill Supabase Firebase reference columns for exact matches only:

```bash
npm run audit:firebase-migration -- --apply-supabase-refs --include-details --output migration-reports/applied.json
```

This updates only nullable Firebase reference/status columns. It does not modify schedule time, subject, instructor name, student name, enrollment, or timetable group content.

## Firestore Collections

The target structure follows S-LMS, with Synchro-S-specific permission constraints:

- `users/{uid}`
- `userProfiles/{uid}`
- `loginAliases/{aliasHash}`
- `userAppAccess/{uid}`
- `students/{studentId}`
- `instructors/{instructorId}`
- `studentPermissions/{studentId}__{instructorId}`
- `synchroMigrationReports/{reportId}`
- `synchroAuditLogs/{logId}`

Use Supabase UUIDs as `studentId` and `instructorId` during the bridge phase. This keeps schedule references stable and avoids rewriting schedule rows.

## Firestore Rules

`firebase/firestore.rules` is a starting policy for Synchro-S:

- admins/coordinators can read and write all account, profile, access, student, instructor, permission, and migration report documents
- instructors can read only permitted student documents
- students can read only their own student document
- general listing of `students` and `studentPermissions` is admin/coordinator-only
- unknown collections are denied by default

Before deployment, test these rules with Firebase Emulator using realistic admin, coordinator, instructor, and student tokens.

## Rollout Order

1. Take a Supabase backup.
2. Apply `0010_firebase_identity_refs.sql`.
3. Run dry-run audit with `SUPABASE_SERVICE_ROLE_KEY`.
4. Review duplicates, ambiguous names, and unmatched rows.
5. Apply Supabase reference fields for exact matches only.
6. Seed Firestore `students`, `instructors`, and `studentPermissions` from the reviewed report.
7. Create Firebase Auth users, `users`, `userProfiles`, `loginAliases`, and `userAppAccess`.
8. Enable Firebase login behind a feature flag while preserving existing Supabase login.
9. Verify admin, coordinator, instructor, and student access.
10. Gradually switch reads to Firebase identity plus Supabase schedule APIs.

## Rollback

If Firebase rollout is paused, leave the nullable reference columns in place and disable the Firebase login feature flag. Existing Supabase schedule and login flows can continue without using the new fields.
