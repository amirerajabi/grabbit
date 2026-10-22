@AGENTS.md

@.claude/rules/code.md

@.claude/rules/safety.md

@.claude/rules/release.md

## Claude Code notes

- The skills in `.claude/skills/` load with the Skill tool (`release`, `test-extensions`, `installer-smoke`,
  `dev-run`). Use them instead of re-deriving the steps.
- `.claude/launch.json` defines `engine` (dev engine on 7310) and `ui` (Vite on 5173) for the browser preview. If the
  user's installed Grabbit is running, it holds port 7310 and the dev engine moves to a random port. Read the port from
  the engine's output (see the `dev-run` skill).
- The GitHub CLI is at `C:\Program Files\GitHub CLI\gh.exe` and is not on the shell's PATH. Call it by full path.
- Update [docs/STATUS.md](docs/STATUS.md) when you release, finish something listed there, or leave work unfinished.
