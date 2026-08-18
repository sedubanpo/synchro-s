export type SyncDraftState<TDraft, TEvent> = {
  syncDraftItems: TDraft[];
  stagedEventUpdates: Record<string, TEvent>;
  stagedDeletedEventIds: string[];
};

export type SyncDraftUndoSnapshot<TDraft, TEvent> = SyncDraftState<TDraft, TEvent> & {
  scopeKey: string;
  label: string;
};

function cloneSyncDraftState<TDraft, TEvent>(state: SyncDraftState<TDraft, TEvent>): SyncDraftState<TDraft, TEvent> {
  return {
    syncDraftItems: [...state.syncDraftItems],
    stagedEventUpdates: { ...state.stagedEventUpdates },
    stagedDeletedEventIds: [...state.stagedDeletedEventIds]
  };
}

export function createSyncDraftUndoSnapshot<TDraft, TEvent>(
  scopeKey: string,
  label: string,
  state: SyncDraftState<TDraft, TEvent>
): SyncDraftUndoSnapshot<TDraft, TEvent> {
  return { scopeKey, label, ...cloneSyncDraftState(state) };
}

export function restoreSyncDraftUndoSnapshot<TDraft, TEvent>(
  snapshot: SyncDraftUndoSnapshot<TDraft, TEvent>,
  scopeKey: string
): SyncDraftState<TDraft, TEvent> | null {
  if (snapshot.scopeKey !== scopeKey) return null;
  return cloneSyncDraftState(snapshot);
}
