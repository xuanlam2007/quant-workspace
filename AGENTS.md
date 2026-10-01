## VNDIRECT reference bundle

- Before any VNDIRECT-inspired implementation, addition, fix, styling change, interaction change, data behavior, or unsupported behavior decision, inspect the relevant JavaScript bundle first. Run CodeGraph from `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\js`, whose index covers both `network_files` and `network_files_chu_hieu`, then inspect `C:\Users\xlam\Desktop\trading view\reverse-engineered vndirect\network js` only as a fallback.
- Treat the VNDIRECT bundle as the source of truth for chart behavior and appearance. Inspect and port the relevant state transitions, calculations, layout, CSS, typography, colors, hover states, and SVG icons before implementing each chart feature. Check the bundle's SVG or inline SVG for every icon; use that asset or path instead of a text glyph or substitute icon. Match the observable VNDIRECT result as closely as the project library permits.
- Prefer porting VNDIRECT's observable calculations, state transitions, interactions, and SVG assets instead of inventing replacement behavior.
- When the project library cannot use the bundle implementation directly, adapt the same state transitions and formulas to the existing APIs.
- State clearly when the bundle does not contain relevant logic or when an exact port is not technically possible.

## Complete reference implementation

- When a user requests a VNDIRECT chart feature or fix, implement the complete observable behavior in the supplied reference, including loading, error, hover, selection, menu, pane, settings, text, typography, color, and bundle SVG states that belong to that feature.
- Resolve every issue in the requested batch before reporting completion. If the current chart library prevents an exact port, identify the missing capability and explain the closest supported behavior.

## Commit message format

- Use Conventional Commits with the exact format `type(scope): lowercase imperative summary | concise vietnamese phrase`.
- Use a specific scope such as `chart`, `chart-data`, `chart-config`, `volume`, or `data`.
- Both phrases must be very short and concise (under 7 words each).
- The Vietnamese phrase MUST always have full, proper Vietnamese diacritics and accents (tiáº¿ng Viá»‡t cÃ³ dáº¥u chuáº©n, tuyá»‡t Ä‘á»‘i khÃ´ng viáº¿t khÃ´ng dáº¥u).
- Always separate the English summary and Vietnamese phrase with ` | `, without parentheses.
- Prepare a separate commit for each changed file by default, and identify every covered file path. Combine related files in one commit only when they form a cohesive change.
- "Commit all changes" means commit every changed file using this grouping rule; it does not mean put every file in one commit.
- When the user asks to commit, include every changed file in the requested task scope. Do not leave files out after committing a convenient subset. Before staging or committing, present the full file scope and obtain approval unless the user has already explicitly requested that commit scope. Afterward, verify that no files from the approved scope remain uncommitted.
- When suggesting commit messages, use one `diff` fenced code block per message. Put the covered file path or paths on the first line, prefixed with `+` so Markdown displays them in green. Put the complete commit message on the second line without a diff prefix. Do not group unrelated changes in one block.
- Do not capitalize the summary, end it with a period, or omit the scope.
- Do not create a Git commit unless the user explicitly requests one.

## Git inspection

- Do not run `git diff` unless the user explicitly requests it.
- Use targeted file inspection and relevant validation commands when verification is needed.

## Communication and builds

- This `AGENTS.md` lives in the shared project workspace and applies to every Orca Codex account that opens this repository. Keep project workflow rules here, not in an account-specific home directory.
- Use English for every user-facing message, including progress updates, summaries, recaps, reports, and final responses. The required Vietnamese phrase inside commit messages is the only exception.
- Skip build commands by default. If a build is genuinely necessary, ask for the user's permission before running it.
- Disable Tab-key navigation throughout the chart UI. Tab must not focus or activate buttons, list rows, search-result items, or toolbar controls unless the user explicitly requests it.
- Run browser tests in a dedicated browser process. After testing, close that process, not only its tabs. Identify the test browser by its process command line or profile before closing it; never close the user's other browser sessions.
- When the user says "Open Luna Assistant" in any Orca account for this project, use `orca terminal list --json` to find that account's Luna Assistant terminal tab. Reuse it when present; otherwise create one in this worktree with `orca terminal create --title "Luna Assistant" --command "codex -m gpt-6-luna -c model_reasoning_effort=medium" --focus --json`. Keep only one Luna Assistant terminal tab active per account for this project. A reload itself does not trigger an agent turn.
- Use `orca terminal send` to delegate project tests, validation checks, and commit message preparation to Luna Assistant. The primary agent handles implementation, file inspection, and ordinary project commands. Give commit messages only inside Luna Assistant, not in the main conversation. Luna Assistant must ask the user before each test or check and wait for a reply. Luna Assistant may stage and commit only when the user explicitly requests a commit, and must follow the commit message format above.
- Before each `orca terminal send`, run `orca terminal list --json` and use Luna Assistant's current terminal handle. Orca can change handles when its terminal host restarts. If a send is blocked or reports a stale request, list terminals again; send to the current Luna handle only when its incarnation has changed. Do not keep retrying the old handle.
- Luna Assistant must ask the user before each test, Node command, lint run, TypeScript check, or browser validation. Orca command approval prompts remain separate and must be handled through Orca's approval interface when required.
- Primary-to-Luna handoffs must identify the next action and instruct Luna to ask the user for approval, then wait for the reply. Use this approval workflow for checks, tests, staging, and commits. An explicit user request or approval covers that specific action; honor it without asking again. After an error is fixed, Luna asks for approval to rerun the relevant check. Respect any later explicit pause from the user.

## Cross-account conversation continuity

- When the user says to continue the VNDIRECT chart conversation from another Orca Codex account, search the local Codex session histories under `%APPDATA%\orca\codex-accounts\*\home\sessions` for sessions from other accounts whose working directory is this repository. Read the relevant user requests and assistant outcomes, summarize the action and status, then continue in the current conversation. Keep unrelated project histories separate. Do not ask the other account to perform the handoff, claim the underlying conversations are natively linked, or modify session history files.
- Use the shared `C:\Users\xlam\.codex\skills\codex-with-chatgpt` installation from every Orca Codex account. Link that directory into a newly added account's `home\skills` folder before using the skill. Keep account sign-in and session files in their original account homes.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
## Agent roles

- The primary Codex agent owns implementation and makes all project code and CSS edits.
- Luna Assistant handles tests, checks, commit messages, and commits only. Luna Assistant must not implement features or edit project code.
- The primary Codex agent handles project shell commands for implementation and file inspection. Luna Assistant only runs authorized tests and checks, prepares commit messages, and commits when explicitly requested.
- If any test or check reports errors, stop further checks and do not stage or commit. Record the command, exit code, exact diagnostics, and affected paths in `.agents/tasks/TASK.md` as a task for the primary agent. The primary agent resolves the errors; resume validation only after that handoff is addressed and the user authorizes the next check.
