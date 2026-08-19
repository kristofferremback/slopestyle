# Attribution

## Commits

Use only the actual model-specific co-author trailer:

```text
Co-Authored-By: <actual model> <provider noreply email>
```

Read the model and provider from the harness or runtime environment. Never copy an example model name. Known provider emails are `noreply@anthropic.com` and `noreply@openai.com`. If identity cannot be determined, report that instead of guessing. Do not add generated-with text or session links.

## Public developer prose

Put the actual model before PR descriptions and comments:

```markdown
_by <actual model>_

[message]
```

Where the platform does not already identify the harness, add it as secondary provenance after the message:

```markdown
---

via [<harness>](<official harness URL>)
```

Use [Claude Code](https://claude.com/claude-code) or [Pi](https://github.com/badlogic/pi-mono). Omit the harness footer in Threa and other contexts where the author identity already carries it. Read the actual model at runtime. Do not include session links.
