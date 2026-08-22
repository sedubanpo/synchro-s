import { formatProspectSchoolGrade, type ProspectSearchProfile } from "@/lib/prospectTimetableGroups";
import { resolveSchoolIconUrl } from "@/lib/sharedIcons";
import type { SelectOption } from "@/types/schedule";

export function buildProspectTimetableBannerProfile(
  prospect: ProspectSearchProfile,
  schoolIconRegistry: ReadonlyMap<string, string>
): SelectOption {
  const school = prospect.school?.trim() ?? "";

  return {
    id: prospect.id,
    name: prospect.name.trim() || "신규문의 대상",
    school: school || undefined,
    secondary: formatProspectSchoolGrade(prospect),
    schoolIconUrl: school ? resolveSchoolIconUrl(schoolIconRegistry, { school }) : undefined
  };
}
