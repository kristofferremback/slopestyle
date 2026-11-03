## Threa access

Read-only Threa credentials exist in `~/.threa.env.agents`. Available keys are `DB_READ_PROXY_URL`, `OPENROUTER_API_KEY`, `THREA_PROD_BASE_URL`, `THREA_STAGING_TOKEN`, `DB_READ_PROXY_SECRET`, `RAILWAY_READONLY_TOKEN`, `THREA_PROD_DEFAULT_WORKSPACE`, `THREA_PROD_READ_ONLY_API_KEY`, and `POSTGRESQL_PROD_READ_ONLY_CONN_STRING`.

Load these credentials only when needed for Threa tasks. Never print, expose, commit, or copy their values into logs, prompts, files, or responses. These keys never pay for subagent or model calls: no OpenRouter consults, no one-shot prompts to other models. Subagent work uses the locally configured providers only, and if a stronger model is needed, ask Kris first.
