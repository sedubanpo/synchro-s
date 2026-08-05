export function parseInstructorRosterActive(value: string): boolean | null {
  const token = value.replace(/\s+/g, "").trim().toLowerCase();
  if (["true", "1", "y", "yes", "재직", "활성", "사용"].includes(token)) return true;
  if (["false", "0", "n", "no", "퇴사", "휴직", "중지", "비활성", "미사용"].includes(token)) return false;
  return null;
}

export function isInstructorRosterActive(
  databaseActive: boolean | null | undefined,
  sheetActive: boolean | undefined,
  firebaseAccountActive?: boolean
): boolean {
  return databaseActive !== false && sheetActive !== false && firebaseAccountActive !== false;
}
