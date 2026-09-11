"use client";

import { useEffect, useRef, useState } from "react";

/** The gauge is an estimate, never proof of a durable server commit. */
export function SaveProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const [estimate, setEstimate] = useState(8);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const timer = window.setInterval(() => {
      if (!document.hidden) setEstimate((value) => Math.min(90, value + Math.max(0.2, (90 - value) * 0.08)));
    }, 500);
    return () => { window.clearInterval(timer); previous?.focus(); };
  }, []);
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setEstimate((value) => Math.max(value, total > 0 ? Math.min(60, (done / total) * 60) : 8)));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [done, total]);
  const progress = Math.min(95, estimate);
  return (
    <div className="fixed inset-0 z-[340] flex items-center justify-center bg-slate-950/40 p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="save-progress-title" aria-describedby="save-progress-description"
        onKeyDown={(event) => { if (event.key === "Tab") event.preventDefault(); }}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_64px_rgba(15,23,42,0.24)] outline-none sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-7 w-7">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 id="save-progress-title" className="text-xl font-bold tracking-tight text-slate-900">시간표를 저장하고 있어요</h2>
        <p id="save-progress-description" role="status" className="mt-2 min-h-10 text-sm leading-5 text-slate-600">{label || "변경한 수업을 서버에 반영하고 있습니다."}</p>
        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-blue-50" role="progressbar" aria-label="시간표 저장 진행 중" aria-valuetext="서버 응답 대기 중 · 예상 진행률">
          <div className="h-full origin-left rounded-full bg-blue-600 transition-transform duration-700 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>완료될 때까지 잠시만 기다려 주세요.</span>
          <span className="shrink-0 tabular-nums text-blue-700">예상 {Math.floor(progress)}%</span>
        </div>
        <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">서버 응답을 기다리고 있습니다. 결과는 이 창이 닫힌 뒤 안내합니다.</p>
      </div>
    </div>
  );
}
