export type ProspectGroupSearchItem = {
  id: string;
  name: string;
  targetId: string;
  weekStart: string;
};

export type ProspectSearchProfile = {
  id: string;
  name: string;
  school?: string | null;
  grade?: string | null;
  memo?: string | null;
};

function normalizeSearchValue(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
}

export function formatProspectGrade(grade: string | null | undefined): string {
  const value = grade?.trim() ?? "";
  if (!value) return "";
  return value.includes("학년") ? value : `${value}학년`;
}

export function formatProspectSchoolGrade(prospect: ProspectSearchProfile | null | undefined): string {
  if (!prospect) return "학생 정보 없음";
  const school = prospect.school?.trim() ?? "";
  const grade = formatProspectGrade(prospect.grade);
  return [school, grade].filter(Boolean).join(" · ") || "학교·학년 정보 없음";
}

export function filterProspectTimetableGroups<T extends ProspectGroupSearchItem>(
  groups: T[],
  prospects: ProspectSearchProfile[],
  weekStart: string,
  query: string
): T[] {
  const profileById = new Map(prospects.map((prospect) => [prospect.id, prospect]));
  const normalizedQuery = normalizeSearchValue(query);

  return groups.filter((group) => {
    if (group.weekStart !== weekStart) return false;
    if (!normalizedQuery) return true;

    const prospect = profileById.get(group.targetId);
    const searchText = [
      group.name,
      prospect?.name,
      prospect?.school,
      prospect?.grade,
      formatProspectGrade(prospect?.grade),
      prospect?.memo
    ]
      .map(normalizeSearchValue)
      .join(" ");

    return searchText.includes(normalizedQuery);
  });
}
