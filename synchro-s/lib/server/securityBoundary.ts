/** App-cookie sessions have no Supabase JWT. Never fall back to anon access. */
export function requireServerDatabaseClient<T>(client: T | null): T {
  if (!client) throw new Error("Server database access is unavailable");
  return client;
}

/** History identifies targets by mutable names, not stable ownership IDs. */
export function canReadGlobalSaveHistory(role: string | null | undefined): boolean {
  return role === "admin" || role === "coordinator";
}
