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

## Fork features not upstream

`/prune` + `/unarchive` + `Shift+A` archiving in `/tree`, collapsible branches in
`/tree` and the HTML export, and `omp gc --merge-duplicates`. The slash-command
registry (`src/slash-commands/builtin-*.ts`) is split into six spread groups
upstream and is where rebase conflicts land every time; `/prune` and `/unarchive`
belong in `builtin-lifecycle.ts` next to `/shake`.
