---
name: datadog
description: Use when querying Datadog traces or diagnosing Datadog API authentication, including Galdera startup and post-deploy checks.
---

# Datadog

Prefer direct API reads for trace investigations. This skill supports inspection, not changes to monitors, retention, infrastructure, or credentials.

## Access

Galdera Labs AB uses the EU site, `https://api.datadoghq.eu`. Kris's credentials live in `/Users/kristofferremback/dev/personal/dotfiles/secrets/shell-credentials`. Source this file in the same shell invocation as the request. A later tool call may start a fresh shell.

Select authentication by the credential type, not its environment variable name:

| Credential | Authentication |
| --- | --- |
| Personal access token, `ddpat_` prefix | `Authorization: Bearer …` |
| Service access token, `ddsat_` prefix | `Authorization: Bearer …` |
| API key and application key | `DD-API-KEY` and `DD-APPLICATION-KEY` headers |

The token currently stored as `DATADOG_API_KEY` is a PAT. PATs and SATs authenticate alone. `/api/v1/validate` validates an API key and rejects a PAT sent as `DD-API-KEY`. Prove PAT access with the intended read endpoint instead. Trace search requires `apm_read` permission.

Keep credentials in process memory and request headers. The helper passes headers to curl through stdin, keeping values out of command arguments and files. Disable shell tracing before sourcing credentials. Inspect presence and type without printing values. If authentication fails, check the scheme and current official documentation before asking Kris to replace a key. New credentials may take a few seconds to propagate.

## Query spans

Use [scripts/spans.py](scripts/spans.py), which requires Python 3 and curl. Run the example from this skill's directory. It reads `DATADOG_API_KEY` or `DD_API_KEY`. Legacy authentication also reads `DATADOG_APP_KEY`, `DATADOG_APPLICATION_KEY`, or `DD_APP_KEY`.

```sh
set +x
source /Users/kristofferremback/dev/personal/dotfiles/secrets/shell-credentials
python3 scripts/spans.py \
  --query 'env:dev service:galdera-api resource_name:api.startup*' \
  --from now-1h --to now \
  --output /tmp/datadog-startup-spans.json
```

The helper requests one page and prints its count, status, sampling metadata, and next cursor. Use `--cursor` to fetch another page. Preserve each page separately if a complete export is needed. The JSON file contains the unmodified response; inspect only the attributes needed for the task.

For Galdera, filter a deployed commit with `@version:FULL_SHA`. Its version is a custom span attribute. `version:SHA` returned no matches even when the revision had traffic. Reserved fields such as `env`, `service`, `resource_name`, `status`, and `trace_id` use no `@` prefix.

Useful resource filters:

- `resource_name:api.startup` selects whole startups.
- `resource_name:api.startup.*` selects startup phases.
- `resource_name:databricks.sql.query` selects SQL operations.
- `status:error` selects recorded errors within the chosen environment and revision.

In search results, each span's `attributes.custom.duration` is nanoseconds. `attributes.trace_id`, `span_id`, `start_timestamp`, and `resource_name` identify and group spans. Use the duration attribute for calculations; timestamps have less precision.

## Interpret and finish

Choose a bounded time window and environment. For deployment comparisons, verify revision attributes and group root startups separately from child phases. Report the sample count and preserve timestamps, trace IDs, revisions, and measured durations in the requested artifact. Keep investigation-specific measurements out of this skill.

Read `meta.status`, `meta.page`, and `meta.traffic_type` before describing coverage. Results can be sampled, partial, or paginated. An empty error query means no matching retained spans were returned. It does not prove that no errors occurred. Successful SQL status also says nothing about latency.

Startup spans cover process startup through listening. They omit browser paint and platform work before the process starts. `app_imports_loaded` includes module loading and top-level execution. One or two traces cannot establish typical performance or isolate the effect of one change in a stack.

Finish with the queried scope, observed evidence, and remaining uncertainty. Use Datadog's official docs when another endpoint or credential type is needed. Browser access is a fallback when API access cannot answer the task and the user permits it.

## Sources

- [Personal access tokens](https://docs.datadoghq.com/account_management/personal-access-tokens/)
- [Service access tokens](https://docs.datadoghq.com/account_management/service-access-tokens/)
- [API and application keys](https://docs.datadoghq.com/account_management/api-app-keys/)
- [Search spans](https://docs.datadoghq.com/api/latest/spans/search-spans/)
- [Span tags and attributes](https://docs.datadoghq.com/tracing/trace_explorer/span_tags_attributes/)
