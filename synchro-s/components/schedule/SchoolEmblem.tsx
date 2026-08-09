"use client";

import { getSchoolName } from "@/lib/sharedIcons";
import type { SelectOption } from "@/types/schedule";
import { useEffect, useState } from "react";

type Props = {
  student: Pick<SelectOption, "name" | "school" | "secondary" | "schoolIconUrl">;
  size?: "xs" | "sm" | "lg";
  className?: string;
};

const sizeClass = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  lg: "h-11 w-11 text-base"
};

export function SchoolEmblem({ student, size = "sm", className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const school = getSchoolName(student);

  useEffect(() => setFailed(false), [student.schoolIconUrl]);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white font-black text-slate-700 ${sizeClass[size]} ${className}`}
      title={school ? `${school} 학교 엠블럼` : `${student.name} 이니셜`}
    >
      {student.schoolIconUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- Firebase assets may be PNG, JPG, WebP, or SVG and are managed externally.
        <img
          src={student.schoolIconUrl}
          alt=""
          className="h-full w-full object-contain p-0.5"
          onError={() => setFailed(true)}
        />
      ) : (
        student.name.trim().slice(0, 1) || "학"
      )}
    </span>
  );
}
