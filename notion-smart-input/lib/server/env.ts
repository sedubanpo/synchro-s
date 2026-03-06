function normalizeEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

export function inspectServerEnv(name: string) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return {
      exists: false,
      normalized: false,
      value: ""
    };
  }

  const value = normalizeEnvValue(rawValue);

  return {
    exists: true,
    normalized: value !== rawValue,
    value
  };
}

export function requireServerEnv(name: string) {
  const inspected = inspectServerEnv(name);

  if (!inspected.exists) {
    throw new Error(`환경 변수 ${name}가 설정되지 않았습니다.`);
  }
  const value = inspected.value;

  if (!value) {
    throw new Error(`환경 변수 ${name}가 비어 있습니다.`);
  }

  return value;
}

export function getOptionalServerEnv(name: string, fallback: string) {
  const inspected = inspectServerEnv(name);

  if (!inspected.exists) {
    return fallback;
  }
  const value = inspected.value;
  return value || fallback;
}
