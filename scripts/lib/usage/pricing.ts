export type Provider = "claude" | "codex";
// A view covers one provider or both. Two providers cannot share an axis in
// credits, so a combined view is priced in API-equivalent dollars.
export type Scope = Provider | "all";
export type UsageUnit = "usd" | "credits";

export const providers: readonly Provider[] = ["claude", "codex"];

export function scopeProviders(scope: Scope): Provider[] {
  return scope === "all" ? [...providers] : [scope];
}

// OpenAI's current Codex credit rates are 25 times its standard API dollar
// rates for every supported model. This is an API-price comparison, not the
// purchase price of a credit, which varies by plan or agreement.
export const codexCreditsPerUsdEquivalent = 25;

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

const claudePrices: Record<string, Price> = {
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

// Credits per million tokens from OpenAI's ChatGPT Work and Codex rate card.
// Codex reports cached input as a subset of input, so callers pass only fresh
// input in `input` and the cached subset in `cacheRead`.
const codexPrices: Record<string, Price> = {
  "gpt-6-astra": { input: 250, output: 1250, cacheRead: 25, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.6-sol": { input: 100, output: 500, cacheRead: 10, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.6-terra": { input: 50, output: 300, cacheRead: 5, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.6-luna": { input: 5, output: 30, cacheRead: 0.5, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.5": { input: 125, output: 750, cacheRead: 12.5, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.4": { input: 62.5, output: 375, cacheRead: 6.25, cacheWrite5m: 0, cacheWrite1h: 0 },
  "gpt-5.4-mini": { input: 18.75, output: 113, cacheRead: 1.875, cacheWrite5m: 0, cacheWrite1h: 0 },
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

export function priceFor(model: string, provider: Provider = "claude"): Price | undefined {
  return (provider === "claude" ? claudePrices : codexPrices)[baseModel(model)];
}

export function usageValue(provider: Provider, model: string, tokens: TokenCounts): number | undefined {
  const price = priceFor(model, provider);
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

export function costUsd(model: string, tokens: TokenCounts): number | undefined {
  return usageValue("claude", model, tokens);
}

export function usageUnit(scope: Scope): UsageUnit {
  return scope === "codex" ? "credits" : "usd";
}

export function usageUsdEquivalent(provider: Provider, value: number): number {
  return provider === "claude" ? value : value / codexCreditsPerUsdEquivalent;
}

// The value a scope displays. A single provider keeps its own unit, so Codex
// stays in credits and Claude in dollars. A combined view converts both to
// API-equivalent dollars, the only unit they share.
export function scopeValue(scope: Scope, provider: Provider, value: number): number {
  return scope === "all" ? usageUsdEquivalent(provider, value) : value;
}
