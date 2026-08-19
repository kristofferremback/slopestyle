# Attribution

## Commits

Use only the actual model-specific co-author trailer:

```text
Co-Authored-By: <actual model> <provider noreply email>
```

Read the model and provider from the harness or runtime environment. Never copy an example model name. Known provider emails are `noreply@anthropic.com` and `noreply@openai.com`. If identity cannot be determined, report that instead of guessing. Do not add generated-with text or session links.

## Public developer prose

Put the actual model before PR descriptions and comments. End every message with a model-and-harness signature:

```markdown
_by <actual model>_

[message]

---

_🤖 [<actual model>](<official model URL>) in [<harness>](<official harness URL>)_
```

Use [Claude Code](https://claude.com/claude-code) or [Pi](https://github.com/badlogic/pi-mono). Link the model to its specific official model page when one exists. Otherwise use the provider's official model catalog. Read the actual model at runtime and use its official name. Never invent a model identity or URL. Do not include session links.
