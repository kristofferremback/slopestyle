---
name: quota
description: Use when Kris asks what is eating Claude or Codex quota, which sessions use the most, how close a limit is, or for usage by session, subagent, model, effort, or time range.
---

# Usage

`slopestyle-usage` indexes Claude Code and Codex transcripts on this machine. Claude usage is priced in API-equivalent dollars. Codex usage uses OpenAI's ChatGPT Work and Codex credit rate card, with the corresponding API-equivalent dollars shown first and raw credits retained for subscription comparisons. Credit purchase prices vary by plan, so neither dollar figure is an invoice. Subscription percentages are still the truth about the plan.

## Ask the tool, not the transcripts

```bash
slopestyle-usage report --provider claude --since 13:00
slopestyle-usage report --provider codex --from 2026-09-01 --to 2026-09-02 --json
slopestyle-usage report --provider all --since 09:00
```

`report` prints the total, sessions ranked by attributed usage, subagent usage, requests, peak context, models, each session's share of the current limit windows, current limit percentages, reset times, and insights. Codex also reports reasoning effort. `--json` returns the same data for further slicing. Claude remains the default provider for compatibility.

`--provider all` covers both providers at once. Two providers cannot share an axis in credits, so a combined view prices everything in API-equivalent dollars.

When the server is running, the same data is at `http://127.0.0.1:<port>/api/timeline`, `/api/sessions`, `/api/sessions/<id>`, `/api/limits`, `/api/quota`, and `/api/insights`. Each takes `provider=claude|codex|all`, `from`, `to` (ISO or unix milliseconds), and `tz` (UTC offset in minutes). A session id is only unique within its provider, so `/api/sessions/<id>` also takes `session_provider=claude|codex`. `slopestyle-ports show` prints the port. `/api/quota` ignores the range and always describes the windows running right now.

## Quota attribution is a split, not a measurement

A plan reports one percentage per window and never says which session spent it. Local transcripts say what each session spent inside that window, so `quota` splits the reported percentage by each session's share of the local spend: a session holding a third of a window that reads 30% used gets 10 points.

That split assumes local transcripts are the whole window. Anything else on the same allowance, chatgpt.com, another machine, or a plan's own accounting rules, inflates every local share by the same factor. Say so whenever you quote these points. Attribution covers the plan-wide 5-hour and weekly windows only. Model-scoped weekly limits count some models and not others, so splitting them by every session's spend would be wrong.

## Answer with the numbers that change a decision

- Name the session by its title, its share of the range, and what made it expensive: peak context, subagent count, request count, model, or reasoning effort.
- Separate the main thread from its subagents. A parent's cost includes its agents.
- Read the insights before writing your own. They already cover the top session, spend above 150k context, sessions that never compacted, fan-outs, inherited models, each window's biggest quota eaters, and what a full 5-hour window is worth.
- For Codex, distinguish local credit attribution from the shared allowance. ChatGPT Work and other agentic features can consume the same allowance without a local transcript, so never assign the unexplained remainder to one product.
- Say which numbers are API-equivalent dollars, OpenAI credit-equivalents, and the plan's real percentages.
