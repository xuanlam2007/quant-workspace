## VNDIRECT reference bundle

- Before any VNDIRECT-inspired implementation, addition, fix, styling change, interaction change, data behavior, or unsupported behavior decision, inspect the relevant JavaScript bundle first. Run CodeGraph from `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\js`, whose index covers both `network_files` and `network_files_chu_hieu`, then inspect `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\network js` only as a fallback.
- Prefer porting VNDIRECT's observable calculations, state transitions, interactions, and SVG assets instead of inventing replacement behavior.
- When the project library cannot use the bundle implementation directly, adapt the same state transitions and formulas to the existing APIs.
- State clearly when the bundle does not contain relevant logic or when an exact port is not technically possible.

## Commit message format

- Use Conventional Commits with the exact format `type(scope): lowercase imperative summary | concise vietnamese phrase`.
- Use a specific scope such as `chart`, `chart-data`, `chart-config`, `volume`, or `data`.
- Both phrases must be very short and concise (under 7 words each).
- The Vietnamese phrase MUST always have full, proper Vietnamese diacritics and accents (tiếng Việt có dấu chuẩn, tuyệt đối không viết không dấu).
- Always separate the English summary and Vietnamese phrase with ` | `, without parentheses.
- Combine related edited files under one commit message only when they form a cohesive change. Use separate messages for unrelated changes, and identify every covered file path.
- Do not capitalize the summary, end it with a period, or omit the scope.
- Do not create a Git commit unless the user explicitly requests one.

## Git inspection

- Do not run `git diff` unless the user explicitly requests it.
- Use targeted file inspection and relevant validation commands when verification is needed.

## Communication and builds

- Use English for every user-facing message, including progress updates, summaries, recaps, reports, and final responses. The required Vietnamese phrase inside commit messages is the only exception.
- Skip build commands by default. If a build is genuinely necessary, ask for the user's permission before running it.
- Do not add Tab-key focus or navigation behavior to buttons, list rows, or search-result items unless the user explicitly requests it.
