import { Client } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import type {
  NotionDatabaseDebugItem,
  PersonDirectoryType,
  PersonOption
} from "@/lib/types";
import { getOptionalServerEnv, requireServerEnv } from "@/lib/server/env";

type GroupDatabaseConfig = {
  key: "student" | "instructor" | "staff" | "main";
  label: string;
  databaseId: string;
  nameProperty?: string;
};

type CollectionAccessMode = "data_source" | "database";

type CollectionSchema = {
  mode: CollectionAccessMode;
  properties: Record<string, any>;
};

type CollectionQueryResponse = {
  results: Array<Record<string, unknown>>;
  has_more: boolean;
  next_cursor: string | null;
};

type NotionPageCreateProperties = Parameters<Client["pages"]["create"]>[0]["properties"];

function getNotionClient() {
  return new Client({
    auth: requireServerEnv("NOTION_API_KEY"),
    notionVersion: getOptionalServerEnv("NOTION_VERSION", "2025-09-03")
  });
}

function getGroupDatabaseConfig(type: PersonDirectoryType): GroupDatabaseConfig {
  if (type === "student") {
    return {
      key: "student",
      label: "재원생 DB",
      databaseId: requireServerEnv("NOTION_STUDENT_DATABASE_ID"),
      nameProperty: requireServerEnv("NOTION_STUDENT_NAME_PROPERTY")
    };
  }

  if (type === "instructor") {
    return {
      key: "instructor",
      label: "강사 DB",
      databaseId: requireServerEnv("NOTION_INSTRUCTOR_DATABASE_ID"),
      nameProperty: requireServerEnv("NOTION_INSTRUCTOR_NAME_PROPERTY")
    };
  }

  return {
    key: "staff",
    label: "실무자 DB",
    databaseId: requireServerEnv("NOTION_STAFF_DATABASE_ID"),
    nameProperty: requireServerEnv("NOTION_STAFF_NAME_PROPERTY")
  };
}

function getMainDatabaseConfig(): GroupDatabaseConfig {
  return {
    key: "main",
    label: "당일 특이사항 DB",
    databaseId: requireServerEnv("NOTION_MAIN_DATABASE_ID")
  };
}

function classifyNotionError(error: unknown): NotionDatabaseDebugItem["status"] {
  if (!(error instanceof Error)) {
    return "unknown_error";
  }

  const normalized = error.message.toLowerCase();

  if (
    normalized.includes("api token is invalid") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid_grant")
  ) {
    return "auth_invalid";
  }

  if (
    normalized.includes("forbidden") ||
    normalized.includes("insufficient_permissions")
  ) {
    return "forbidden";
  }

  if (
    normalized.includes("restricted_resource") ||
    normalized.includes("object_not_found") ||
    normalized.includes("could not find database") ||
    normalized.includes("could not find data source")
  ) {
    return "not_shared_or_not_found";
  }

  if (
    normalized.includes("속성을 찾지 못했습니다") ||
    normalized.includes("title 또는 rich_text 타입이어야")
  ) {
    return "config_error";
  }

  return "unknown_error";
}

export function getDirectoryDatabaseMeta(type: PersonDirectoryType) {
  const config = getGroupDatabaseConfig(type);

  return {
    label: config.label,
    databaseId: config.databaseId
  };
}

export function getAllDatabaseDebugTargets() {
  return [
    getGroupDatabaseConfig("student"),
    getGroupDatabaseConfig("instructor"),
    getGroupDatabaseConfig("staff"),
    getMainDatabaseConfig()
  ];
}

function getPropertyType(properties: Record<string, any>, propertyName: string, databaseId: string) {
  const property = properties[propertyName];

  if (!property) {
    throw new Error(`Notion DB(${databaseId})에서 '${propertyName}' 속성을 찾지 못했습니다.`);
  }

  if (property.type === "title") {
    return property.type;
  }

  if (property.type === "rich_text") {
    return property.type;
  }

  throw new Error(`'${propertyName}' 속성은 title 또는 rich_text 타입이어야 합니다.`);
}

function findTitlePropertyName(properties: Record<string, any>, databaseId: string) {
  const entry = Object.entries(properties).find(([, property]) => property?.type === "title");

  if (!entry) {
    throw new Error(`Notion DB(${databaseId})에서 title 속성을 찾지 못했습니다.`);
  }

  return entry[0];
}

function findRelationPropertyName(
  properties: Record<string, any>,
  databaseId: string,
  group: PersonDirectoryType
) {
  const configuredCandidates = [
    getOptionalServerEnv(
      group === "student"
        ? "NOTION_MAIN_RELATION_PROPERTY_STUDENT"
        : group === "instructor"
          ? "NOTION_MAIN_RELATION_PROPERTY_INSTRUCTOR"
          : "NOTION_MAIN_RELATION_PROPERTY_STAFF",
      ""
    ),
    getOptionalServerEnv("NOTION_MAIN_RELATION_PROPERTY", "")
  ].filter(Boolean);

  for (const candidate of configuredCandidates) {
    const property = properties[candidate];

    if (property?.type === "relation") {
      return candidate;
    }
  }

  const groupKeywordMap: Record<PersonDirectoryType, string[]> = {
    student: ["재원생", "학생"],
    instructor: ["강사"],
    staff: ["실무자", "직원", "스태프"]
  };

  const relationEntries = Object.entries(properties).filter(([, property]) => property?.type === "relation");
  const matchedEntry = relationEntries.find(([name]) =>
    groupKeywordMap[group].some((keyword) => name.includes(keyword))
  );

  if (matchedEntry) {
    return matchedEntry[0];
  }

  if (relationEntries.length === 1) {
    return relationEntries[0][0];
  }

  const availableRelationNames = relationEntries.map(([name]) => name).join(", ");

  if (availableRelationNames) {
    throw new Error(
      `Notion DB(${databaseId})에서 ${group} 대상 relation 속성을 찾지 못했습니다. 사용 가능한 relation 속성: ${availableRelationNames}`
    );
  }

  throw new Error(`Notion DB(${databaseId})에 relation 속성이 없습니다.`);
}

function getTodayInSeoul() {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("현재 날짜를 계산하지 못했습니다.");
  }

  return `${year}-${month}-${day}`;
}

async function retrieveCollectionSchema(config: GroupDatabaseConfig): Promise<CollectionSchema> {
  const notion = getNotionClient();

  try {
    const dataSource = await notion.request<{ properties: Record<string, any> }>({
      path: `data_sources/${config.databaseId}`,
      method: "get"
    });

    return {
      mode: "data_source",
      properties: dataSource.properties ?? {}
    };
  } catch (dataSourceError) {
    try {
      const database = await notion.databases.retrieve({
        database_id: config.databaseId
      });

      return {
        mode: "database",
        properties: (database as any).properties ?? {}
      };
    } catch {
      throw dataSourceError;
    }
  }
}

async function queryCollection(
  config: GroupDatabaseConfig,
  mode: CollectionAccessMode,
  cursor?: string
): Promise<CollectionQueryResponse> {
  const notion = getNotionClient();

  if (mode === "data_source") {
    return notion.request<CollectionQueryResponse>({
      path: `data_sources/${config.databaseId}/query`,
      method: "post",
      body: {
        page_size: 100,
        start_cursor: cursor
      }
    });
  }

  return notion.databases.query({
    database_id: config.databaseId,
    page_size: 100,
    start_cursor: cursor
  }) as unknown as CollectionQueryResponse;
}

function extractNameFromPage(page: PageObjectResponse, propertyName: string) {
  const property = page.properties[propertyName];

  if (!property) {
    return "";
  }

  if (property.type === "title") {
    return property.title.map((item) => item.plain_text).join("").trim();
  }

  if (property.type === "rich_text") {
    return property.rich_text.map((item) => item.plain_text).join("").trim();
  }

  return "";
}

export async function listPersonsByType(type: PersonDirectoryType): Promise<PersonOption[]> {
  const config = getGroupDatabaseConfig(type);
  const nameProperty = config.nameProperty;

  if (!nameProperty) {
    throw new Error(`${config.label}의 이름 속성 설정이 없습니다.`);
  }

  const schema = await retrieveCollectionSchema(config);
  getPropertyType(schema.properties, nameProperty, config.databaseId);

  const persons: PersonOption[] = [];
  let cursor: string | undefined;

  do {
    const queryResult = await queryCollection(config, schema.mode, cursor);

    const pages = queryResult.results.filter(
      (result): result is PageObjectResponse => "properties" in result
    );

    for (const page of pages) {
      const name = extractNameFromPage(page, nameProperty);

      if (name) {
        persons.push({
          id: page.id,
          name
        });
      }
    }

    cursor = queryResult.has_more ? queryResult.next_cursor ?? undefined : undefined;
  } while (cursor);

  return persons.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function inspectDatabaseAccess(
  config: GroupDatabaseConfig
): Promise<NotionDatabaseDebugItem> {
  try {
    const schema = await retrieveCollectionSchema(config);

    const nameProperty = config.nameProperty;

    if (nameProperty) {
      getPropertyType(schema.properties, nameProperty, config.databaseId);
    }

    return {
      key: config.key,
      label: config.label,
      databaseId: config.databaseId,
      status: "ok",
      detail: `접근 가능 (${schema.mode})`
    };
  } catch (error) {
    return {
      key: config.key,
      label: config.label,
      databaseId: config.databaseId,
      status: classifyNotionError(error),
      detail: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
    };
  }
}

export async function createIncidentPage(input: {
  group: PersonDirectoryType;
  personPageId: string;
  summary: string;
  targetDate: string | null;
}) {
  const notion = getNotionClient();
  const mainConfig = getMainDatabaseConfig();
  const schema = await retrieveCollectionSchema(mainConfig);
  const titlePropertyName = findTitlePropertyName(schema.properties, mainConfig.databaseId);
  const relationPropertyName = findRelationPropertyName(schema.properties, mainConfig.databaseId, input.group);
  const datePropertyName = getOptionalServerEnv("NOTION_MAIN_DATE_PROPERTY", "");
  const properties: NotionPageCreateProperties = {
    [titlePropertyName]: {
      title: [
        {
          text: {
            content: input.summary
          }
        }
      ]
    },
    [relationPropertyName]: {
      relation: [{ id: input.personPageId }]
    }
  } as NotionPageCreateProperties;

  if (datePropertyName) {
    properties[datePropertyName] = {
      date: {
        start: input.targetDate || getTodayInSeoul()
      }
    };
  }

  let createdPage:
    | {
        id: string;
        url?: string;
      }
    | undefined;

  try {
    createdPage = await notion.request<{ id: string; url?: string }>({
      path: "pages",
      method: "post",
      body: {
        parent: {
          data_source_id: mainConfig.databaseId
        },
        properties
      }
    });
  } catch (dataSourceError) {
    try {
      createdPage = await notion.pages.create({
        parent: {
          database_id: mainConfig.databaseId
        },
        properties
      });
    } catch {
      throw dataSourceError;
    }
  }

  if (!createdPage) {
    throw new Error("Notion 페이지 생성 결과가 비어 있습니다.");
  }

  return {
    id: createdPage.id,
    url: "url" in createdPage ? createdPage.url : null
  };
}
