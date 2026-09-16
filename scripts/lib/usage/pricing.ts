// USD per million tokens at Anthropic API list prices. Subscription plans meter
// differently, so every figure derived from this table is labeled as an
// API-equivalent proxy in the UI and the API.

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

const prices: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite5m: 12.5, cacheWrite1h: 20 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
};

export interface TokenCounts {
  input: number;
  cache5m: number;
  cache1h: number;
  cacheRead: number;
  output: number;
}

// "claude-opus-5[1m]" and dated snapshots like "claude-haiku-4-5-20251001"
// price as their base model.
export function baseModel(model: string): string {
  const stripped = model.replace(/\[1m\]$/i, "");
  return stripped.replace(/-\d{8}$/, "");
}

export function priceFor(model: string): Price | undefined {
  return prices[baseModel(model)];
}

export function costUsd(model: string, tokens: TokenCounts): number | undefined {
  const price = priceFor(model);
  if (!price) return undefined;
  return (
    (tokens.input * price.input +
      tokens.cache5m * price.cacheWrite5m +
      tokens.cache1h * price.cacheWrite1h +
      tokens.cacheRead * price.cacheRead +
      tokens.output * price.output) /
    1e6
  );
}
