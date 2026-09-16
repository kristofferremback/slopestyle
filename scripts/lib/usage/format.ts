// Token counts for people: 850, 12k, 1.2M, 34M, 1.6B.
export function tokenCount(n: number): string {
  const scaled = (value: number, unit: string) => `${value >= 9.95 ? Math.round(value) : value.toFixed(1)}${unit}`;
  if (n >= 999_500_000) return scaled(n / 1_000_000_000, "B");
  if (n >= 999_500) return scaled(n / 1_000_000, "M");
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// The share of a request's or session's input that came from cache reads.
export function cachedShare(inputTokens: number, cacheReadTokens: number): string {
  return inputTokens > 0 ? `${Math.round((cacheReadTokens / inputTokens) * 100)}% cached` : "";
}
