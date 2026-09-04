// Token counts for people: 850, 12k, 1.2M, 34M.
export function tokenCount(n: number): string {
  if (n >= 999_500) {
    const millions = n / 1_000_000;
    return `${millions >= 9.95 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// The share of a request's or session's input that came from cache reads.
export function cachedShare(inputTokens: number, cacheReadTokens: number): string {
  return inputTokens > 0 ? `${Math.round((cacheReadTokens / inputTokens) * 100)}% cached` : "";
}
