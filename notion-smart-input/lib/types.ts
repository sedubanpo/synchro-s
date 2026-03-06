export type PersonDirectoryType = "student" | "instructor" | "staff";

export type PersonGroupLabel = "재원생" | "강사" | "실무자";

export type PersonOption = {
  id: string;
  name: string;
};

export type PersonsApiSuccess = {
  ok: true;
  persons: PersonOption[];
};

export type NotionEnvDebugSuccess = {
  ok: true;
  notionApiKey: {
    exists: boolean;
    normalized: boolean;
    prefix: string | null;
    length: number;
  };
};

export type NotionDatabaseDebugItem = {
  key: "student" | "instructor" | "staff" | "main";
  label: string;
  databaseId: string;
  status:
    | "ok"
    | "auth_invalid"
    | "forbidden"
    | "not_shared_or_not_found"
    | "config_error"
    | "unknown_error";
  detail: string;
};

export type NotionDatabaseDebugSuccess = {
  ok: true;
  databases: NotionDatabaseDebugItem[];
};

export type IncidentApiSuccess = {
  ok: true;
  personPageId: string;
  summary: string;
  targetDate: string | null;
  notionPageId: string;
  notionPageUrl: string | null;
};

export type ApiError = {
  ok: false;
  code:
    | "INVALID_REQUEST"
    | "INVALID_QUERY"
    | "NOTION_AUTH_INVALID"
    | "NOTION_FORBIDDEN"
    | "NOTION_RESOURCE_NOT_SHARED"
    | "NOTION_CONFIG_ERROR"
    | "INTERNAL_ERROR";
  error: string;
};
