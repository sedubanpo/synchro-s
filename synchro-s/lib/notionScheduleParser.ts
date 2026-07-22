const INVISIBLE_NOTION_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;
const CLASS_DIVIDER = /[-‐‑‒–—―]/;

export type ParsedNotionClassCell = {
  subjectLabel: string;
  classTypeLabel: string;
  instructorName: string;
  rawText: string;
};

export function normalizeNotionCellText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_NOTION_CHARACTERS, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .trim();
}

export function normalizeInstructorAlias(value: string): string {
  const token = normalizeNotionCellText(value).replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
  if (token === "원장님" || token === "원장" || token === "원장님t" || token === "원장t") {
    return "안준성";
  }
  return normalizeNotionCellText(value).replace(/(?:선생님|강사|t)$/i, "").trim();
}

export function parseNotionClassCell(cell: string): ParsedNotionClassCell {
  const rawText = cell.trim();
  const normalized = normalizeNotionCellText(cell);
  const instructorMatches = [...normalized.matchAll(/\(([^()]*)\)/g)];
  const instructorMatch = instructorMatches.at(-1);

  if (!instructorMatch || instructorMatch.index === undefined) {
    return { subjectLabel: normalized, classTypeLabel: "개별정규", instructorName: "", rawText };
  }

  const prefix = normalized.slice(0, instructorMatch.index).trim();
  const divider = prefix.match(CLASS_DIVIDER);
  if (!divider || divider.index === undefined) {
    return { subjectLabel: normalized, classTypeLabel: "개별정규", instructorName: "", rawText };
  }

  const subjectLabel = prefix.slice(0, divider.index).trim();
  const classTypeLabel = prefix.slice(divider.index + divider[0].length).trim();
  const instructorName = normalizeInstructorAlias(instructorMatch[1] ?? "");

  if (!subjectLabel || !classTypeLabel || !instructorName) {
    return { subjectLabel: normalized, classTypeLabel: "개별정규", instructorName: "", rawText };
  }

  return { subjectLabel, classTypeLabel, instructorName, rawText };
}
