import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual client save handler with isolated persistence adapters.
const source = readFileSync(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const handleSaveSyncDraftsToServer = useCallback(async () => {");
const end = source.indexOf("\n  }, [", start);
const handler = source.slice(start, end).replace("  const handleSaveSyncDraftsToServer = useCallback(", "(") + "\n})";
assert.ok(start > 0 && end > start);
assert.doesNotMatch(handler, /saveTimetableGroupSnapshot\(/, "source version must not be overwritten");
const js = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const deletedIds of [["c2"], ["c1", "c2"], ["self-study:s1:mon"], ["c2", "self-study:s1:mon"], ["c1", "c2", "self-study:s1:mon"]]) {
  const hasSelfStudy = deletedIds.some(id => id.startsWith("self-study:"));
  const original = { id: "old", isActive: true, snapshotEvents: [{ id: "c1", startTime: "10:00" }, { id: "c2", startTime: "11:00" }, ...(hasSelfStudy ? [{ id: "self-study:s1:mon", startTime: "12:00" }] : [])] };
  const remaining = original.snapshotEvents.filter(event => !deletedIds.includes(event.id));
  const requests: any[] = [];
  const before = JSON.stringify(original.snapshotEvents);
  const versions: any[] = [original];
  const errors: string[] = [];
  let selected = "old";
  const noop = () => {};
  const context: any = {
    Date, Map, Set, console, savingSyncDrafts: false, syncDraftSaveInFlightRef: { current: false },
    selectedScheduleTagId: "sep", selectedStudentId: "s1", currentTargetId: "s1", currentTargetLabel: "검증학생",
    selectedStudentLabel: "검증학생", selectedScheduleTagLabel: "9월", weekStart: "2026-09-07",
    hasPendingTimetableChanges: true, pendingTimetableChangeCount: deletedIds.length,
    syncDraftItems: [], stagedEventUpdates: {}, stagedDeletedEventIds: deletedIds,
    displayEvents: remaining,
    hiddenDays: [1, 2, 3, 4, 5, 6, 7], hiddenTimeSlots: ["10:00", "11:00"],
    importingNotionRef: { current: false }, subjects: [], instructors: [], classTypes: [], students: [],
    effectiveStudentGroupByTargetId: new Map(),
    isSyncDraftEventId: (id: string) => id.startsWith("draft-"),
    isSelfStudyEventId: (id: string) => id.startsWith("self-study:"),
    extractSnapshotClassIds: (events: any[]) => events.map(e => e.id),
    setError: (error: string) => { if (error) errors.push(error); }, setSelectedGroupId: (id: string) => { selected = id; },
    createTimetableGroup: async (input: any) => {
      assert.equal(input.isActive, true);
      original.isActive = false;
      const result = { ...input, id: "new", isActive: true };
      versions.push(result); return result;
    },
    fetch: async (url: string, init: any) => {
      if (init.method === "DELETE") requests.push({url, body: JSON.parse(init.body)});
      return { ok: true, status: 200, json: async () => ({}) };
    },
    recordConflictLogs: noop, setSavingSyncDrafts: noop, setImportProgress: noop, setConflictDialog: noop,
    setMemoByEventId: noop, setIsCreatingNewSyncTimetable: noop, setSyncDraftItems: noop,
    setStagedEventUpdates: noop, setStagedDeletedEventIds: noop, setSyncDraftUndoState: noop,
    setNotice: noop, loadWeek: noop, loadSaveHistory: noop, loadOverviewEvents: noop, loadScheduleReviews: noop
  };
  await vm.runInNewContext(js, context)();
  assert.deepEqual(errors, []);
  assert.equal(versions.length, 2);
  assert.equal(JSON.stringify(original.snapshotEvents), before);
  assert.equal(original.isActive, false);
  assert.equal(versions[1].snapshotEvents.length, remaining.length);
  const realIds = deletedIds.filter(id => !id.startsWith("self-study:"));
  assert.equal(requests.length, realIds.length ? 1 : 0, "Self-study-only deletion must not call the classes API.");
  if (realIds.length) assert.deepEqual(requests[0].body.classIds, realIds);
  assert.equal(selected, "new");
  assert.equal(context.syncDraftSaveInFlightRef.current, false);
}
console.log("PASS: actual save handler creates and selects a new active version; old snapshot preserved; deletion-only and empty versions covered.");
