#!/usr/bin/env bun
// Read one page of Datadog EU spans. Credentials stay in process memory and request headers.

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const usage = "Usage: spans.ts --query QUERY [--from now-1h] [--to now] [--limit 100] [--cursor CURSOR] [--output PATH]";

function fail(message: string): never {
  console.error(`${usage}\nerror: ${message}`);
  process.exit(2);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function authentication(): { headers: Record<string, string>; secrets: string[] } {
  const env = process.env;
  const token = env.DATADOG_API_KEY || env.DD_API_KEY;
  if (!token) fail("Source shell-credentials first; DATADOG_API_KEY is absent.");
  if (token.startsWith("ddpat_") || token.startsWith("ddsat_")) {
    return { headers: { Authorization: `Bearer ${token}` }, secrets: [token] };
  }
  const appKey = env.DATADOG_APP_KEY || env.DATADOG_APPLICATION_KEY || env.DD_APP_KEY;
  if (!appKey) {
    fail("Credential is not a recognized PAT or SAT. Check its type. Legacy API-key authentication also requires DATADOG_APP_KEY.");
  }
  return { headers: { "DD-API-KEY": token, "DD-APPLICATION-KEY": appKey }, secrets: [token, appKey] };
}

function options() {
  try {
    return parseArgs({
      options: {
        query: { type: "string" },
        from: { type: "string", default: "now-1h" },
        to: { type: "string", default: "now" },
        limit: { type: "string", default: "100" },
        cursor: { type: "string" },
        output: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    fail(errorMessage(error));
  }
}

const values = options();
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (!values.query) {
  fail("--query is required");
}
const limit = /^\d+$/.test(values.limit) ? Number(values.limit) : Number.NaN;
if (!(limit >= 1 && limit <= 1000)) {
  fail("--limit must be between 1 and 1000");
}

const { headers, secrets } = authentication();
const page: Record<string, unknown> = { limit };
if (values.cursor) {
  page.cursor = values.cursor;
}
const payload = {
  data: {
    type: "search_request",
    attributes: { filter: { from: values.from, to: values.to, query: values.query }, page, sort: "-timestamp" },
  },
};

const redact = (text: string) => secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), text);
let response: Response;
try {
  response = await fetch("https://api.datadoghq.eu/api/v2/spans/events/search", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
} catch (error) {
  console.error(`Datadog request failed: HTTP unavailable. ${redact(errorMessage(error)).slice(0, 1000)}`);
  process.exit(1);
}
const body = await response.text();
if (response.status !== 200) {
  console.error(`Datadog request failed: HTTP ${response.status}. ${redact(body).slice(0, 1000)}`);
  process.exit(1);
}

const result = JSON.parse(body);
if (values.output) {
  writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`);
  const meta = result.meta ?? {};
  console.log(JSON.stringify({
    output: values.output,
    count: (result.data ?? []).length,
    status: meta.status ?? null,
    traffic_type: meta.traffic_type ?? null,
    next_cursor: meta.page?.after ?? null,
  }));
} else {
  console.log(JSON.stringify(result, null, 2));
}
