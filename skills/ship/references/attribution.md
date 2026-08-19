# Attribution

## Commits

Use only the actual model-specific co-author trailer:

```text
Co-Authored-By: <actual model> <provider noreply email>
```

Read the model and provider from the harness or runtime environment. Never copy an example model name. Known provider emails are `noreply@anthropic.com` and `noreply@openai.com`. If identity cannot be determined, report that instead of guessing. Do not add generated-with text or session links.

## Public developer prose

Add a small harness marker before PR descriptions and comments, then detailed model and harness attribution after the message.

```markdown
_by <harness>_

[message]

---

🤖 <actual model> via [<harness>](<official harness URL>)
```

Use `Claude` with [Claude Code](https://claude.com/claude-code), or `Pi` with [Pi](https://github.com/badlogic/pi-mono). Read the actual model at runtime. Do not include session links.
