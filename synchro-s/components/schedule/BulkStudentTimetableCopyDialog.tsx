"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSynchroFirebaseAuth } from "@/lib/firebase/client";
import { getIdToken } from "firebase/auth";

type TagOption = { id: string; name: string; isActive: boolean };
type StudentOption = { id: string; name: string };

type BulkCopyPreview = {
  sourceTag: { id: string; name: string };
  destinationTag: { id: string; name: string };
  destinationWeekStart: string;
  requestedStudentCount: number;
  activeStudentCount: number;
  copyCount: number;
  totalClassCount: number;
  missingSource: StudentOption[];
  destinationExists: StudentOption[];
  containsOneOff: StudentOption[];
  excludedInactiveCount: number;
  rosterSource: "firebase" | "supabase";
  previewToken: string;
};

async function apiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error ?? fallback;
}

async function requestHeaders(): Promise<HeadersInit> {
  const auth = getSynchroFirebaseAuth();
  await auth.authStateReady();
  const token = auth.currentUser ? await getIdToken(auth.currentUser) : null;
  return token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
}

export function BulkStudentTimetableCopyDialog({
  tags,
  students,
  currentTagId,
  currentWeekStart,
  onCompleted
}: {
  tags: TagOption[];
  students: StudentOption[];
  currentTagId: string | null;
  currentWeekStart: string;
  onCompleted: (message: string, destinationTagId: string) => Promise<void> | void;
}) {
  const activeTags = useMemo(() => tags.filter((tag) => tag.isActive), [tags]);
  const sourceTags = tags;
  const [open, setOpen] = useState(false);
  const [sourceTagId, setSourceTagId] = useState("");
  const [destinationTagId, setDestinationTagId] = useState("");
  const [destinationWeekStart, setDestinationWeekStart] = useState(currentWeekStart);
  const [preview, setPreview] = useState<BulkCopyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const destination = currentTagId && activeTags.some((tag) => tag.id === currentTagId) ? currentTagId : activeTags.at(-1)?.id ?? "";
    const destinationIndex = sourceTags.findIndex((tag) => tag.id === destination);
    const source = (destinationIndex > 0 ? sourceTags[destinationIndex - 1] : sourceTags.find((tag) => tag.id !== destination))?.id ?? "";
    setDestinationTagId(destination);
    setSourceTagId(source);
    setDestinationWeekStart(currentWeekStart);
    setPreview(null);
    setError("");
    requestAnimationFrame(() => closeButtonRef.current?.focus());
  }, [activeTags, currentTagId, currentWeekStart, open, sourceTags]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
      if (event.key === "Tab") {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])];
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, open]);

  const invalidatePreview = () => {
    setPreview(null);
    setError("");
  };

  const requestPreview = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPreview(null);
    setError("");
    try {
      const response = await fetch("/api/schedules/groups/bulk-copy", {
        method: "POST",
        headers: await requestHeaders(),
        body: JSON.stringify({
          mode: "preview",
          sourceTagId,
          destinationTagId,
          destinationWeekStart,
          studentIds: students.map((student) => student.id)
        })
      });
      if (!response.ok) throw new Error(await apiError(response, "일괄 복사 미리보기를 만들지 못했습니다."));
      const payload = (await response.json()) as { preview: BulkCopyPreview };
      setPreview(payload.preview);
    } catch (previewError) {
      setError(previewError instanceof TypeError ? "서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 미리보기를 다시 눌러 주세요." : previewError instanceof Error ? previewError.message : "일괄 복사 미리보기를 만들지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const executeCopy = async () => {
    if (!preview || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/schedules/groups/bulk-copy", {
        method: "POST",
        headers: await requestHeaders(),
        body: JSON.stringify({
          mode: "execute",
          sourceTagId,
          destinationTagId,
          destinationWeekStart,
          studentIds: students.map((student) => student.id),
          previewToken: preview.previewToken
        })
      });
      if (!response.ok) throw new Error(await apiError(response, "전체 재원생 시간표 복사에 실패했습니다."));
      const payload = (await response.json()) as { result: BulkCopyPreview & { copiedCount: number } };
      setOpen(false);
      await onCompleted(
        `${payload.result.copiedCount}명의 시간표를 #${payload.result.destinationTag.name}(으)로 복사했습니다.`,
        destinationTagId
      );
    } catch (copyError) {
      setPreview(null);
      setError(copyError instanceof TypeError ? "서버 응답을 확인하지 못했습니다. 미리보기를 다시 실행해 이미 복사된 시간표를 확인해 주세요." : copyError instanceof Error ? copyError.message : "전체 재원생 시간표 복사에 실패했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        disabled={sourceTags.length < 2 || activeTags.length === 0 || students.length === 0}
        className={`sync-pressable sync-focus inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-black ${
          sourceTags.length < 2 || activeTags.length === 0 || students.length === 0
            ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500"
            : "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
        }`}
        title={sourceTags.length < 2 ? "시간표 태그가 2개 이상 필요합니다" : "전체 재원생의 저장 시간표를 다른 태그로 복사"}
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="6.5" y="3.5" width="9" height="10" rx="1.5" />
          <path d="M4.5 6.5h-1v9h8v-1M9 7h4M9 10h4" strokeLinecap="round" />
        </svg>
        전체 태그 복사
      </button>

      {open ? (
        <div className="fixed inset-0 z-[280] flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-copy-title"
            className="sync-surface max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-4 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.7)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="bulk-copy-title" className="text-base font-black text-slate-950">전체 재원생 시간표 태그 복사</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  원본 태그의 활성 저장본을 학생별로 하나씩 복사합니다. 대상 태그에 저장본이 이미 있는 학생은 덮어쓰지 않고 건너뜁니다.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="sync-pressable sync-focus min-h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                닫기
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-black text-slate-700">
                원본 시간표 태그
                <select
                  value={sourceTagId}
                  disabled={busy}
                  onChange={(event) => { setSourceTagId(event.target.value); invalidatePreview(); }}
                  className="sync-input mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {sourceTags.map((tag) => <option key={tag.id} value={tag.id}>#{tag.name}{tag.isActive ? "" : " (보관)"}</option>)}
                </select>
              </label>
              <label className="text-xs font-black text-slate-700">
                복사할 대상 태그
                <select
                  value={destinationTagId}
                  disabled={busy}
                  onChange={(event) => { setDestinationTagId(event.target.value); invalidatePreview(); }}
                  className="sync-input mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  {activeTags.map((tag) => <option key={tag.id} value={tag.id}>#{tag.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-black text-slate-700 sm:col-span-2">
                대상 기준 주차 (월요일)
                <input
                  type="date"
                  value={destinationWeekStart}
                  disabled={busy}
                  onChange={(event) => { setDestinationWeekStart(event.target.value); invalidatePreview(); }}
                  className="sync-input mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <span className="mt-1 block font-semibold leading-4 text-slate-500">우측 위젯의 월 표시는 이 기준 주차의 목요일이 속한 달을 따릅니다.</span>
              </label>
            </div>

            {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-700">{error}</p> : null}

            {preview ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-3" aria-live="polite">
                <p className="text-sm font-black text-slate-900">복사 전 확인</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <div><dt className="font-semibold text-slate-500">복사 대상</dt><dd className="mt-0.5 text-lg font-black text-blue-700">{preview.copyCount}명</dd></div>
                  <div><dt className="font-semibold text-slate-500">수업 합계</dt><dd className="mt-0.5 text-lg font-black text-slate-900">{preview.totalClassCount}개</dd></div>
                  <div><dt className="font-semibold text-slate-500">원본 없음</dt><dd className="mt-0.5 text-lg font-black text-amber-700">{preview.missingSource.length}명</dd></div>
                  <div><dt className="font-semibold text-slate-500">대상 태그 보유</dt><dd className="mt-0.5 text-lg font-black text-slate-700">{preview.destinationExists.length}명</dd></div>
                  <div><dt className="font-semibold text-slate-500">일회성 포함</dt><dd className="mt-0.5 text-lg font-black text-rose-700">{preview.containsOneOff.length}명</dd></div>
                </dl>
                {(preview.missingSource.length > 0 || preview.destinationExists.length > 0 || preview.containsOneOff.length > 0) ? (
                  <div className="mt-3 space-y-1 text-[11px] font-semibold leading-4 text-slate-600">
                    {preview.missingSource.length > 0 ? <p>원본 없음: {preview.missingSource.slice(0, 8).map((item) => item.name).join(", ")}{preview.missingSource.length > 8 ? ` 외 ${preview.missingSource.length - 8}명` : ""}</p> : null}
                    {preview.destinationExists.length > 0 ? <p>기존 저장본 보호: {preview.destinationExists.slice(0, 8).map((item) => item.name).join(", ")}{preview.destinationExists.length > 8 ? ` 외 ${preview.destinationExists.length - 8}명` : ""}</p> : null}
                    {preview.containsOneOff.length > 0 ? <p>일회성 수업 포함(안전상 제외): {preview.containsOneOff.slice(0, 8).map((item) => item.name).join(", ")}{preview.containsOneOff.length > 8 ? ` 외 ${preview.containsOneOff.length - 8}명` : ""}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy || !sourceTagId || !destinationTagId || sourceTagId === destinationTagId || !destinationWeekStart}
                onClick={() => void requestPreview()}
                className="sync-pressable sync-focus min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy && !preview ? "확인 중..." : "복사 대상 미리보기"}
              </button>
              {preview ? (
                <button
                  type="button"
                  disabled={busy || preview.copyCount === 0}
                  onClick={() => void executeCopy()}
                  className="sync-pressable sync-focus min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {busy ? "복사 중..." : `${preview.copyCount}명 복사 실행`}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
