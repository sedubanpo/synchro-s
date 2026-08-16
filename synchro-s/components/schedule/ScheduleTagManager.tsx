"use client";

import { useState } from "react";

export type ScheduleTag = {
  id: string;
  name: string;
  colorKey: "blue" | "emerald" | "amber" | "rose" | "violet" | "slate";
  sortOrder: number;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
};

const COLORS: { key: ScheduleTag["colorKey"]; label: string; swatch: string }[] = [
  { key: "blue", label: "파랑", swatch: "bg-blue-500" },
  { key: "emerald", label: "초록", swatch: "bg-emerald-500" },
  { key: "amber", label: "노랑", swatch: "bg-amber-500" },
  { key: "rose", label: "분홍", swatch: "bg-rose-500" },
  { key: "violet", label: "보라", swatch: "bg-violet-500" },
  { key: "slate", label: "회색", swatch: "bg-slate-500" }
];

export const SCHEDULE_TAG_TONES: Record<ScheduleTag["colorKey"], string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700"
};

type Props = {
  open: boolean;
  tags: ScheduleTag[];
  busy?: boolean;
  onClose: () => void;
  onOpenSubjectSettings: () => void;
  onCreate: (input: { name: string; colorKey: ScheduleTag["colorKey"] }) => Promise<void>;
  onUpdate: (id: string, input: { name?: string; colorKey?: ScheduleTag["colorKey"]; isActive?: boolean; isCurrent?: boolean }) => Promise<void>;
};

export function ScheduleTagManager({ open, tags, busy = false, onClose, onOpenSubjectSettings, onCreate, onUpdate }: Props) {
  const [name, setName] = useState("");
  const [colorKey, setColorKey] = useState<ScheduleTag["colorKey"]>("blue");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="설정창">
      <div className="sync-surface w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">Schedule Scope</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">설정창</h2>
            <p className="sync-copy mt-1 text-xs font-semibold text-slate-500">상황별 시간표를 분리해 서로 다른 안이 충돌 계산에 섞이지 않도록 관리합니다.</p>
          </div>
          <button type="button" onClick={onClose} className="sync-pressable sync-focus h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-100">닫기</button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-blue-50/60 px-4 py-3">
          <div>
            <p className="text-xs font-black text-slate-900">태그 관리</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500">시간표 태그와 과목 코드를 한곳에서 관리합니다.</p>
          </div>
          <button
            type="button"
            onClick={onOpenSubjectSettings}
            className="sync-pressable sync-focus min-h-10 rounded-md border border-violet-200 bg-white px-3 text-xs font-black text-violet-700 shadow-sm hover:bg-violet-50"
          >
            과목 코드 설정
          </button>
        </div>

        <form
          className="grid gap-2 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const nextName = name.trim();
            if (!nextName || busy) return;
            void onCreate({ name: nextName, colorKey }).then(() => setName(""));
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="예: 여름방학 A안" className="sync-input h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <select value={colorKey} onChange={(event) => setColorKey(event.target.value as ScheduleTag["colorKey"])} className="sync-input h-10 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-blue-400">
            {COLORS.map((color) => <option key={color.key} value={color.key}>{color.label}</option>)}
          </select>
          <button type="submit" disabled={busy || !name.trim()} className="sync-pressable sync-focus h-10 rounded-md bg-blue-600 px-4 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">태그 추가</button>
        </form>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-4">
          {tags.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">첫 상황 태그를 만들어 주세요.</p>
          ) : tags.map((tag) => (
            <div key={tag.id} className={`grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_auto_auto_auto] ${tag.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
              <input defaultValue={tag.name} onBlur={(event) => { const next = event.target.value.trim(); if (next && next !== tag.name) void onUpdate(tag.id, { name: next }); }} className="sync-input min-w-0 rounded-md border border-transparent bg-transparent px-2 py-2 text-sm font-black text-slate-800 outline-none hover:border-slate-200 focus:border-blue-400 focus:bg-white" />
              <button
                type="button"
                disabled={busy || !tag.isActive || tag.isCurrent}
                onClick={() => void onUpdate(tag.id, { isCurrent: true })}
                className={`sync-pressable sync-focus min-h-10 rounded-md border px-3 text-[11px] font-black transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-out disabled:cursor-default ${
                  tag.isCurrent
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                }`}
              >
                {tag.isCurrent ? "현재 분류" : "현재로 설정"}
              </button>
              <select value={tag.colorKey} onChange={(event) => void onUpdate(tag.id, { colorKey: event.target.value as ScheduleTag["colorKey"] })} className={`h-8 rounded-md border px-2 text-[11px] font-black outline-none ${SCHEDULE_TAG_TONES[tag.colorKey]}`}>
                {COLORS.map((color) => <option key={color.key} value={color.key}>{color.label}</option>)}
              </select>
              <button type="button" disabled={tag.isCurrent} onClick={() => void onUpdate(tag.id, { isActive: !tag.isActive })} className={`sync-pressable sync-focus min-h-10 rounded-md border px-3 text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-60 ${tag.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{tag.isActive ? "사용 중" : "보관됨"}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
