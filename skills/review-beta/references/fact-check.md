# Fact-check

Decide whether each finding is true. Its value is decided later in Report.

Every finding ends as exactly one of:

- **confirmed**: you reproduced the claim in source or with a focused probe.
- **unverified**: you could neither prove nor disprove it. It stays in the report.
- **disproven**: source proves it wrong. It leaves the findings and is listed with the line that disproves it.

The two possible mistakes cost different amounts. Keeping a wrong finding costs Kris a few seconds. Removing a true finding destroys it silently, and nobody learns it existed. Doubt, low value, and disagreement with the fix all lead to confirmed or unverified.

## Method

Take the steps in order for each finding and stop at the first that applies. Write the analysis for each finding before its outcome.

1. **Protected subject.** The finding concerns memory safety or bounds, concurrency or synchronization, declaration and definition consistency, a behavior or compatibility change (a field, status, message, default, or error path the old code produced and the new code changes), authorization or data exposure, or a parameter accepted and never used. Try to confirm it. It ends confirmed or unverified, whatever you believe about the language or runtime.
2. **Absent code.** The construct the finding describes is missing from its own `path` in the fixed diff. It can't be rescued by the same construct appearing in a sibling file. Disproven.
3. **Direct contradiction.** A specific source line, in any file, states the opposite of the finding's central claim. Examples: an identifier called unused is used, a check called missing is present, a value called hardcoded comes from a variable. You can read the contradiction straight off the line. Disproven, naming that line.
4. **Everything else.** Read and probe to confirm. What you cannot settle stays unverified.

Before concluding step 2 or 3, search for what the finding describes, beyond the snippet it quotes. A finding that quotes the wrong line while describing code that exists is true and continues to step 4. When reaching a contradiction takes more than one inference, there is none. Continue to step 4.
