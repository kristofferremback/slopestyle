---
name: beg-for-reviews
description: Use when the user asks to beg for reviews or manage reviewer notification preferences.
---
1. Resolve this skill's directory from the loaded `SKILL.md` location. Run `bun <skill-directory>/scripts/preferences.ts --help`, then `bun <skill-directory>/scripts/preferences.ts list` to find saved reviewers and scopes.
2. Match each requested reviewer and work context to a saved preference. A scope is a work context such as a GitHub organization or repository; reuse existing scope/person keys. Use a stable person identifier when known. If several preferences fit and disagree, ask Kris which applies.
3. Follow the saved free-form instruction, including every requested notification route. Supported routes include Slack mentions, GitHub review requests (which may propagate to Linear), and direct Linear actions. Use `use-slack`, `use-github`, or `use-linear` for the corresponding action and live identity resolution. If no preference exists, use Slack in a channel like #reviews unless otherwise specified. Report a blocked route before substituting another.
4. Keep Slack requests brief, with mentions, linked PRs, and agent credit through `use-slack`.

One: @user could you :eyes: #1, please? Fixes retries.

Many: @user, could you :eyes: these, please?
- #1 Fixes retries
- #2 Speeds tests

## Preferences

When Kris gives or changes a preference, save it with `set`, which replaces that reviewer's instruction in that scope. Use `delete SCOPE PERSON` to forget it. Store the whole instruction as ordinary text: channels, mentions, GitHub usernames, order, and multiple routes can all live in the string. Preferences guide an authorized review request; they do not authorize outreach themselves. The current request takes precedence over stored preferences.

Example write with synthetic identities:

```sh
bun <skill-directory>/scripts/preferences.ts set <<'JSON'
{"scope":"github.com/example","person":"github:alex-example","preference":"Request review from alex-example on GitHub so it propagates to Linear, then mention <@U-example> in #reviews on Slack."}
JSON
```

Actual preferences live only in `~/.local/state/slopestyle/beg-for-reviews/preferences.sqlite`, outside Git with private filesystem permissions. They persist until changed or deleted. The helper has JSON input/output and no network access; `--db PATH` selects a scratch database. Keep per-person facts in the database and supported behavior in this skill.
