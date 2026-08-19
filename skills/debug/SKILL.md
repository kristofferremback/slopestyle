---
name: debug
description: Use when the user asks to debug, diagnose, reproduce, or fix a hard bug, flaky failure, crash, incorrect result, or performance regression.
---

# Debug

Build a tight, red-capable feedback loop before implementing a permanent fix. Immediate incident containment may come first, but permanent fixes require evidence.

1. **Feedback loop:** create one fast, deterministic, agent-runnable command that drives the real bug path and can detect the user's exact symptom. For flakes, raise and measure reproduction rate.
2. **Reproduce and minimise:** observe the reported failure, repeat it, then remove inputs and steps one at a time until every remaining part is load-bearing.
3. **Hypotheses:** write 3 to 5 ranked, falsifiable causes with the prediction each makes. Send the list as an AFK-safe milestone, then continue.
4. **Instrument:** test one prediction at a time. Prefer debugger or targeted boundary logs. Tag temporary instrumentation uniquely. Measure performance before changing it.
5. **Fix:** correct the root cause at the smallest complete seam. Do not add a guard that merely silences the symptom.
6. **Regress:** when a correct test seam exists, turn the minimal repro into a failing test before the fix, then watch it pass. Do not add misleading shallow coverage.
7. **Clean:** rerun the original scenario, remove all tagged instrumentation and throwaway harnesses, and state the proven cause.

If no red-capable loop is possible, list what was tried and the missing evidence, access, artifact, or safe instrumentation needed. Do not guess a permanent fix. Never require Kris to operate a terminal-only loop from his phone.
