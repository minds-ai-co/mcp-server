/**
 * Pure-function helpers for the MCP server's session-eviction sweep
 * (PR #1556 — "evict idle sessions after 30 min to prevent memory leak").
 *
 * Extracted from server/mcp/main.ts so the boundary cases can be unit-
 * tested without booting the MCP HTTP server. The runtime behavior is
 * unchanged: `main.ts` calls `pruneIdleSessions(sessions, SESSION_TTL_MS,
 * Date.now())` from a 5-minute setInterval.
 *
 * Invariants this enforces:
 *   - A session is evicted iff `now - lastUsedAt > ttlMs` (exclusive
 *     boundary, matching the pre-extraction behavior in main.ts where
 *     exactly TTL-old sessions survive one more sweep).
 *   - Eviction calls `transport.close()` BEFORE removing the entry from
 *     the map, and swallows any close-error so one bad transport can't
 *     block other evictions on the same sweep.
 *   - Sessions touched within the TTL window survive.
 *   - Returns the list of evicted ids so the caller can log them.
 */

export interface EvictableSession {
  lastUsedAt: number
  transport: { close: () => Promise<unknown> | void }
}

/**
 * Evict every session whose `lastUsedAt` is older than (now - ttlMs).
 * Returns the list of evicted session ids (in iteration order).
 *
 * Pure / synchronous from the caller's perspective. `transport.close()`
 * is invoked but the returned promise (if any) is intentionally not
 * awaited — production sweep prefers fast removal over guaranteed close
 * completion, and the StreamableHTTPServerTransport's close() is
 * non-throwing on its own.
 */
export function pruneIdleSessions<S extends EvictableSession>(
  sessions: Map<string, S>,
  ttlMs: number,
  now: number,
): string[] {
  const cutoff = now - ttlMs
  const evicted: string[] = []
  for (const [id, session] of sessions) {
    if (session.lastUsedAt < cutoff) {
      try {
        const ret = session.transport.close()
        // Swallow async rejections — see invariant above.
        if (ret && typeof (ret as Promise<unknown>).then === 'function') {
          (ret as Promise<unknown>).catch(() => {})
        }
      } catch {
        // intentional: a bad transport must not block other evictions
      }
      sessions.delete(id)
      evicted.push(id)
    }
  }
  return evicted
}
