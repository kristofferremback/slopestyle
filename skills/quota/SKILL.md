---
name: quota
description: Use when Kris asks what is eating his Claude usage or quota, which sessions cost the most, how close a 5-hour or weekly limit is, or for spend by session, subagent, model, or time range.
---

# Usage

`slopestyle-usage` indexes every Claude Code transcript on this machine and answers spend questions with API-equivalent dollars. Subscriptions meter differently, so quote the figures as a proxy and the limit percentages as the truth.

## Ask the tool, not the transcripts

```bash
slopestyle-usage report --since 13:00           # from a local time today until now
slopestyle-usage report --from 2026-09-01 --to 2026-09-02 --json
```

`report` prints the total, the sessions ranked by cost with subagent cost, requests, peak context and models, the current limit percentages with their reset times, and the insights. `--json` returns the same as one object for further slicing.

When the server is running, the same data is at `http://127.0.0.1:<port>/api/timeline`, `/api/sessions`, `/api/sessions/<id>`, `/api/limits`, and `/api/insights`, each taking `from`, `to` (ISO or unix milliseconds) and `tz` (UTC offset in minutes). `slopestyle-ports show` prints the port.

## Answer with the numbers that change a decision

- Name the session by its title, its share of the range, and what made it expensive: peak context, subagent count, request count, or model.
- Separate the main thread from its subagents. A parent's cost includes its agents.
- Read the insights before writing your own. They already cover the top session, spend above 150k context, sessions that never compacted, fan-outs, expensive single requests, inherited models, and what a full 5-hour window is worth.
- Say which numbers are API list prices and which are the plan's real percentages.
