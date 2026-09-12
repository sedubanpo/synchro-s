"use client";

import { useEffect, useId, useRef } from "react";

export function ScheduleConflictDialog({ title, message, onClose }: {
  title: string; message: string; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const bodyId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // SaveProgress can be unmounting in the same commit; take focus afterwards.
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const readableMessage = message
    .replace(/\bONE_TO_ONE\b/g, "1:1")
    .replace(/\bTWO_TO_ONE\b/g, "2:1")
    .replace(/\bTHREE_TO_ONE\b/g, "3:1")
    .replace(/\bREGULAR_MULTI\b/g, "개별정규");
  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/40 p-4">
      <div ref={panel} role="alertdialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={bodyId}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-[0_24px_64px_rgba(15,23,42,0.24)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "Tab") {
            const controls = panel.current?.querySelectorAll<HTMLElement>("button");
            const first = controls?.[0]; const last = controls?.[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <div className="flex items-start gap-3 px-6 pt-6">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 h-6 w-6 shrink-0 text-rose-600">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3h.01" strokeLinecap="round" />
          </svg>
          <h2 id={headingId} className="min-w-0 flex-1 text-balance text-xl font-bold leading-7">{title === "DB 저장 실패" ? "시간표를 저장하지 못했어요" : title || "시간표를 확인해 주세요"}</h2>
          <button type="button" aria-label="오류 안내 닫기" onClick={onClose} className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div id={bodyId} className="min-h-0 overflow-y-auto px-6 pb-6 pt-4 text-sm leading-6 [overflow-wrap:anywhere]">
          {readableMessage.split(/\n+/).filter(Boolean).map((line, index) => (
            <p key={index} className={line.startsWith("겹치는 기존 수업:") ? "mt-2 rounded-lg bg-slate-100 p-3 font-semibold tabular-nums" : "mt-2 whitespace-pre-wrap text-pretty text-slate-700"}>
              {line.replace(/^충돌 이유:\s*/, "")}
            </p>
          ))}
        </div>
        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <button ref={closeButton} type="button" onClick={onClose} className="min-h-10 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">시간표로 돌아가기</button>
        </div>
      </div>
    </div>
  );
}
