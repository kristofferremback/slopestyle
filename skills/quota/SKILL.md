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
```

`report` prints the total, sessions ranked by attributed usage, subagent usage, requests, peak context, models, current limit percentages, reset times, and insights. Codex also reports reasoning effort. `--json` returns the same data for further slicing. Claude remains the default provider for compatibility.

When the server is running, the same data is at `http://127.0.0.1:<port>/api/timeline`, `/api/sessions`, `/api/sessions/<id>`, `/api/limits`, and `/api/insights`. Each takes `provider=claude|codex`, `from`, `to` (ISO or unix milliseconds), and `tz` (UTC offset in minutes). `slopestyle-ports show` prints the port.

## Answer with the numbers that change a decision

- Name the session by its title, its share of the range, and what made it expensive: peak context, subagent count, request count, model, or reasoning effort.
- Separate the main thread from its subagents. A parent's cost includes its agents.
- Read the insights before writing your own. They already cover the top session, spend above 150k context, sessions that never compacted, fan-outs, expensive single requests, inherited models, and what a full 5-hour window is worth.
- For Codex, distinguish local credit attribution from the shared allowance. ChatGPT Work and other agentic features can consume the same allowance without a local transcript, so never assign the unexplained remainder to one product.
- Say which numbers are API-equivalent dollars, OpenAI credit-equivalents, and the plan's real percentages.
