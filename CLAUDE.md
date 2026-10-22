@AGENTS.md

@.claude/rules/code.md

@.claude/rules/safety.md

@.claude/rules/release.md

## Claude Code notes

- The skills in `.claude/skills/` load with the Skill tool (`release`, `test-extensions`, `installer-smoke`,
  `dev-run`). Use them instead of re-deriving the steps.
- `.claude/launch.json` defines `dev` for the browser preview (`scripts/run.mjs browser`, UI on 5173). When the user's
  installed Grabbit holds port 7310, the launcher moves the dev engine to a free port and tells the UI. Find the port
  with `preview_logs` (search `engine`); see the `dev-run` skill.
- The GitHub CLI is at `C:\Program Files\GitHub CLI\gh.exe` and is not on the shell's PATH. Call it by full path.
- Update [docs/STATUS.md](docs/STATUS.md) when you release, finish something listed there, or leave work unfinished.
