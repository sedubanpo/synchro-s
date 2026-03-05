type TeacherAuthRecord = {
  loginId: string;
  teacherName: string;
  password: string;
};

const DEFAULT_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010")) return digits;
  if (digits.length === 10 && digits.startsWith("10")) return `0${digits}`;
  if (digits.length === 8) return `010${digits}`;
  if (digits.length > 11) return digits.slice(-11);
  return digits;
}

function isPhoneMatch(inputId: string, rowId: string): boolean {
  const input = normalizePhone(inputId);
  const row = normalizePhone(rowId);
  if (!input || !row) return false;
  if (input === row) return true;
  const inputTail = input.slice(-8);
  const rowTail = row.slice(-8);
  return inputTail.length === 8 && inputTail === rowTail;
}

async function fetchSheetCsv(spreadsheetId: string, sheetName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Google Sheets fetch failed (${sheetName}): ${res.status}`);
  return res.text();
}

export async function loadTeachersAuthRecords(): Promise<TeacherAuthRecord[]> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SYNC_ID || DEFAULT_SPREADSHEET_ID;
  const csv = await fetchSheetCsv(spreadsheetId, "Teachers");
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const headers = rows[0] ?? [];
  const normalized = headers.map(normalizeHeader);
  const idIndex =
    normalized.findIndex((value) => value.includes("비밀번호(id)") || value.includes("id")) >= 0
      ? normalized.findIndex((value) => value.includes("비밀번호(id)") || value.includes("id"))
      : 0;
  const teacherNameIndex = normalized.findIndex((value) => value.includes("선생님성함") || value.includes("강사명") || value.includes("name"));
  const passwordIndex =
    normalized.findIndex((value) => value === "비밀번호" || value.includes("password")) >= 0
      ? normalized.findIndex((value) => value === "비밀번호" || value.includes("password"))
      : 6;

  return rows
    .slice(1)
    .map((row) => ({
      loginId: (row[idIndex] ?? "").trim(),
      teacherName: (row[teacherNameIndex >= 0 ? teacherNameIndex : 1] ?? "").trim(),
      password: (row[passwordIndex] ?? "").trim()
    }))
    .filter((row) => row.loginId && row.teacherName && row.password);
}

export async function verifyTeacherSheetCredential(loginId: string, password: string): Promise<{ teacherName: string } | null> {
  const records = await loadTeachersAuthRecords();
  const row = records.find((item) => isPhoneMatch(loginId, item.loginId) && item.password === password.trim());
  if (!row) return null;
  return { teacherName: row.teacherName };
}
