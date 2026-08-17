export type StudentScheduleInputTab = "sync" | "notion" | "availability";

type Props = {
  activeTab: StudentScheduleInputTab;
  onChange: (tab: StudentScheduleInputTab) => void;
  className?: string;
};

const TABS: Array<{ id: StudentScheduleInputTab; label: string }> = [
  { id: "sync", label: "싱크로 시간표" },
  { id: "notion", label: "노션 시간표" },
  { id: "availability", label: "가능 일정" }
];

export function StudentScheduleTabs({ activeTab, onChange, className = "" }: Props) {
  return (
    <nav
      aria-label="학생 시간표 입력 방식"
      className={`inline-flex w-full rounded-xl bg-slate-100 p-1 ${className}`}
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={activeTab === tab.id ? "page" : undefined}
          onClick={() => onChange(tab.id)}
          className={`sync-pressable sync-focus min-h-10 flex-1 whitespace-nowrap rounded-lg px-2 text-[11px] font-black transition-[background-color,box-shadow,color] duration-150 ease-out ${
            activeTab === tab.id
              ? "bg-white text-blue-700 shadow-[0_0_0_1px_rgba(37,99,235,0.18),0_8px_18px_rgba(37,99,235,0.08)]"
              : "text-slate-600 hover:bg-white/70 hover:text-slate-900"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
