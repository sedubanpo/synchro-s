export type SharedIconAsset = {
  category?: string;
  lookupKey?: string;
  aliases?: string[];
  imageUrl?: string;
  status?: string;
};

export function normalizeSharedIconName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function getSchoolName(value: { school?: string | null; secondary?: string | null }): string {
  const explicit = normalizeSharedIconName(value.school);
  if (explicit) return (value.school ?? "").trim().replace(/\s+/g, " ");
  return (value.secondary ?? "").split("·")[0]?.trim().replace(/\s+/g, " ") ?? "";
}

export function buildSchoolIconRegistry(assets: SharedIconAsset[]): Map<string, string> {
  const registry = new Map<string, string>();
  for (const asset of assets) {
    if (asset.category !== "SCHOOL" || asset.status !== "ACTIVE" || !asset.imageUrl) continue;
    const directKey = asset.lookupKey?.startsWith("school:")
      ? normalizeSharedIconName(asset.lookupKey.slice("school:".length))
      : "";
    if (directKey && !registry.has(directKey)) registry.set(directKey, asset.imageUrl);
    for (const alias of asset.aliases ?? []) {
      const aliasKey = normalizeSharedIconName(alias.replace(/^school:/i, ""));
      if (aliasKey && !registry.has(aliasKey)) registry.set(aliasKey, asset.imageUrl);
    }
  }
  return registry;
}

export function resolveSchoolIconUrl(
  registry: ReadonlyMap<string, string>,
  student: { school?: string | null; secondary?: string | null }
): string | undefined {
  const school = getSchoolName(student);
  return registry.get(normalizeSharedIconName(school));
}
