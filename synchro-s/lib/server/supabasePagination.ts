const DEFAULT_PAGE_SIZE = 500;

export type SupabasePage<T> = {
  data: T[] | null;
  error: unknown | null;
};

/**
 * Supabase/PostgREST limits the number of rows returned by one request.
 * Roster reads must page explicitly or students near the end of the ordered
 * result disappear once the table grows beyond the server response limit.
 */
export async function fetchAllSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePage<T>>,
  pageSize = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("Supabase page size must be a positive integer.");
  }

  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

/** Bound IN-filter URL length and concurrency as well as the response row count. */
export async function fetchSupabaseRowsByIds<T>(
  ids: string[],
  fetchPage: (ids: string[], from: number, to: number) => PromiseLike<SupabasePage<T>>
): Promise<T[]> {
  const uniqueIds = [...new Set(ids)];
  const rows: T[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const batches = Array.from({ length: Math.min(4, Math.ceil((uniqueIds.length - offset) / 100)) }, (_, index) =>
      uniqueIds.slice(offset + index * 100, offset + (index + 1) * 100)
    );
    const results = await Promise.all(batches.map((batch) => fetchAllSupabaseRows<T>((from, to) => fetchPage(batch, from, to))));
    results.forEach((result) => rows.push(...result));
  }
  return rows;
}
