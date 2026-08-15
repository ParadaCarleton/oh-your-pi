# Fork-local notes (`ParadaCarleton/oh-your-pi`)

Read `AGENTS.md` first — it is upstream's and it governs. This file holds only
things that are true of **this fork** and would otherwise be rediscovered the
hard way. It does not exist upstream, so keep it out of PR branches: fork-only
commits, never cherry-picked into a `pr/*` branch.

## `ompf` rebases the fork underneath you

`ompf --fork-rebuild` (in `~/.local/bin/ompf`, worktree `~/.local/share/omp-fork`)
rebases `omp-fork` onto current upstream before building. Consequences:

- Commit hashes in your notes go stale after any build. Re-read `git log` instead
  of trusting a remembered hash.
- The build key lives in `~/.cache/ompf/omp.key` and pins the built HEAD.
- The build follows whatever `HEAD` points at. Leaving the worktree checked out
  on a `pr/*` branch silently ships a different feature set — check out
  `omp-fork` in the same turn you finish with a PR branch.
- `ompf` now refuses to build when the worktree is not on `omp-fork` (guard added
  after a PR branch, which is cut from upstream and has no `scripts/ompf-compile.ts`,
  turned every launch into "Module not found" plus a silent fall back to a stale
  binary). `OMPF_BRANCH` overrides the expected branch.

## Subagents: name the directory they will actually be in

Two `--merge-sessions` attempts failed and left `gc-cli.ts` half-renamed. The
second revealed why: the subagent worked in `~/Projects/oh-my-pi` — the session
cwd — not the `~/.local/share/omp-fork` worktree its brief named. Both share one
`.git`, so the edits landed on whatever branch that checkout happened to have.
Before delegating anything that edits files: put the work on the branch the agent
will actually see, or have it `cd` and confirm with `git -C <dir> status -sb`
first. And never check a second branch out of a shared repo while an agent is
running — that is how the same worktree ends up with two writers.

## Refuted readings

- **"The changelog entries are under `[Unreleased]`, so they will stay there."**
  They will not. Upstream cuts releases by renaming `## [Unreleased]` in place and
  inserting a fresh one above it, so every line the fork added under that heading
  is carried *into the released section* by the next rebase — and released
  sections are immutable per `AGENTS.md`, plus `bun run release` will never look
  there again. This has now happened twice (upstream 17.2.10 and 17.2.15). After
  any `ompf --fork-rebuild`, check `sed -n '1,20p' packages/coding-agent/CHANGELOG.md`
  and re-hoist the fork's entries under the live `[Unreleased]`. Fixing it once
  does not fix it; it recurs per upstream release.
- **"A duplicated session means one file is a stale copy of the other."**
  No. Measured on session `019f6d5f-4aee-7000-a3ab-3b62adc9b302`: 3,367 shared
  entry ids, 9,403 unique to the larger file, **38 unique to the smaller one**,
  file order diverging after 177 entries, and the two session headers disagreeing
  on `title`. Deleting either copy loses conversation. Hence
  `omp gc --merge-duplicates` (union by id) rather than a dedupe.
- **"`SessionEntry` is what session files contain."** It is not: the header is a
  separate `SessionHeader` with **no `parentId`**, and loaders return
  `FileEntry = SessionHeader | SessionEntry`. Type new session-file code against
  `FileEntry` and partition on `type === "session"`; typing it as `SessionEntry`
  makes the header check a provable-impossible comparison (TS2367) and invites a
  `String(x.type)` cast to silence it.
- **"`stopReason: "length"` is an unfinished reply, so `/prune` should drop it."**
  Deliberately not: the text before the token-limit cut is real content. Only
  `error`, `aborted`, and `toolUse` count as unanswered. Pinned by
  `test/session-manager/tree-traversal.test.ts`.
- **"Session-level emptiness is the `/prune` branch rule applied file-wide."**
  It is not. `#emptyBranchVerdict()` can treat a `toolUse` reply as unanswered
  because the real answer hangs *beneath* it and the verdict propagates up the
  tree. Flattened over a whole file there is no propagation, and nearly every
  assistant message in an agent loop ends on a tool call, so the flat rule
  condemns ordinary work: it flagged 4 of 129 real sessions here, including a
  411 KB one holding 6,528 characters of assistant prose. The session rule is
  "any assistant message carried text or ended its turn normally".
- **"`parentSession` holds a session id."** Sometimes a path, absolute or
  relative. Resolving only the id form made lineage discovery report
  `parent session <existing path> is missing` and silently hide an 8.4 MB fork.
- **"A read-only probe can open a session with `SessionManager.open`."** Fine as
  it turns out — replaying the probe against a copy left the line count
  unchanged — but `session_exit` breadcrumbs carry no pid or cwd, so you cannot
  attribute one to a process afterwards. Do not guess who wrote what; measure.
- **"mtime tells you whether a session is live."** It cannot distinguish closed a
  minute ago from open right now, and the 5-minute grace refused merges on
  conversations the user had just closed. `session-liveness.ts` asks the OS
  instead: omp's advisory lock, `/proc/*/fd` (or `lsof`), and `/proc/locks` by
  device+inode. The last matters because omp's Linux lock is an abstract Unix
  socket and never appears in `/proc/locks`.
- **"A flag can default to a value when passed bare."** Not through this CLI
  layer without help: it wraps `node:util.parseArgs`, which rejects a bare
  `--flag` for a string option, and `default:` fires when the flag is *absent*
  (which would arm a destructive pass on every run). Use
  `Flags.string({ optionalValue })`, added in `packages/utils/src/cli.ts`.

## Fork features not upstream

`/prune` + `/unarchive` + `Shift+A` archiving in `/tree`, collapsible branches in
`/tree` and the HTML export, and `omp gc --merge-duplicates`. The slash-command
registry (`src/slash-commands/builtin-*.ts`) is split into six spread groups
upstream and is where rebase conflicts land every time; `/prune` and `/unarchive`
belong in `builtin-lifecycle.ts` next to `/shake`.
