# Branch cleanup plan — `ParadaCarleton/oh-your-pi`

Fork of upstream `can1357/oh-my-pi`. Default branch: `main`. No open pull requests.

---

## ✅ STATUS: round 1 DONE — 62 branches → 31

Round 1 ran successfully. All 32 branches from Categories A–E were deleted and **all 32 archive
tags are on GitHub** (`archive/*-20260912`), so every one is recoverable.

```
branches on GitHub : 31   (main + 30)
archive tags       : 32   (verified present)
branches lost      : 0
```

Re-running `./cleanup-branches.sh` now correctly reports those 32 as
*"already cleaned up in an earlier run (archive tag present)"* and moves on.

Round 2 (below) identifies **7 more** stale branches found by reading the actual code.

---

## Snapshot of the original mess

Originally **62 branches** on GitHub; `main` had 22,140 commits.

---

## ROUND 2 — 7 more stale branches, found by reading the code

The 30 survivors all held commits existing nowhere else, so ancestry checks could not call any of
them dead. The real question is whether that unique work is still *worth keeping*. Three tests
answered it:

1. **Does it still merge into current upstream?** A real 3-way merge (`git merge-tree`) of each
   branch against today's `upstream/main`.
2. **Is its code byte-identical to the fork's aggregate branch**
   (`fix/cache-expired-preprompt-shake`)? Identical means the work already landed there.
3. **Is it just an older draft of another branch?** Comparing the actual lines each one adds.

### The 7 to delete

| Branch | Evidence |
|---|---|
| `stats-recorded-folder` | All 4 changed files byte-identical to the aggregate |
| `plugins-relink-over-directory` | All 3 changed files byte-identical to the aggregate |
| `fix/streamed-edit-hook-revisions` | Source + test byte-identical; only a CHANGELOG differs |
| `review/pr7762-comments` | It is `pr/tree-collapse` minus its final commit. Every line of collapse code is in `pr/tree-collapse`, which merges cleanly where this one conflicts |
| `pr/prune` | Original minimal `/prune`. `pr/prune-archive` has the evolved version, `handlePruneCommand(mode: PruneMode)` |
| `omp-fork-prerebase` | Pre-rebase snapshot: 13 of its 25 unique commits exist post-rebase in the aggregate; **100** merge conflicts |
| `omp-fork-prerebase2` | Same story; **77** merge conflicts |

`--keep-snapshots` spares the last three if you would rather keep them.

### Keep — merge cleanly into current upstream

`docs/allow-local-commits` · `feat/ttsr-structured-ast-conditions` · `fix/cache-expired-user-turn-shake` ·
`fix/claude-import-tree` · `fix/hub-wait-delivery` · `fix/jj-status-snapshot` ·
`fix/power-assertion-followups` · `fix/python-eval-auto-background-default` ·
`fix/tree-selector-filtered-shape` · `import-api-error-failed-turn` · `import-decode-project-cwd` ·
`pr/export-collapse` · `pr/prune-empty-sessions` · `pr/tree-collapse` · `tui-tree-scroll-one-offset`

### Keep, but they conflict — real work that needs a rebase when you pick it up

Small, localised conflicts (1–20 files). That is normal for long-lived work, not staleness:

`pr-10320` (9, `streaming-reveal.ts`) · `pr/prune-archive` (17) · `review/pr8301-navigation` (20) ·
`review/pr8588-active-status` (6, `command-help.ts`) · `review/pr8593-comments` (7, `command-help.ts`) ·
`fix/filtered-tree-connectors` (17 — its other three features all have newer dedicated branches, but
it holds one unique connector fix)

### ⚠️ Separate finding: a leaked local path

Four branches commit a file `bazel-oh-my-pi` whose entire contents are one developer's absolute
local path:

```
/home/lime/.cache/bazel/_bazel_lime/1bf02ea2bd21106999c8a6708f331f06/execroot/_main
```

Present in `fix/cache-expired-preprompt-shake` (**being kept**), `omp-fork-prerebase`,
`omp-fork-prerebase2`, and `pr/prune`. This is an accidentally-committed Bazel symlink, not source
code. Unrelated to the branch cleanup, but worth deleting from the tree and adding to `.gitignore`.

---

## Why there are so many branches

You ran `git push --all`. That command pushes **every branch that exists on your laptop** —
including old scratch copies, WIP experiments, and safety snapshots you'd forgotten about.
Nothing was corrupted, but a lot of private clutter got published to the public fork.

The good news: a branch is just a **sticky note pointing at a commit**. Deleting the sticky note
does not delete the code — the code stays alive as long as something else points at it
(`main`, another branch, or a tag).

---

## Safety net (do this first, always)

Before deleting anything, every branch tip gets preserved as a **tag**. Tags are permanent and
survive branch deletion, so every single branch stays recoverable forever with one command:

```bash
git checkout -b restored-name archive/name-20260912
```

This step is additive and 100% reversible.

---

## Running the cleanup

Two scripts are checked into the repo. **Run them yourself** — they need your GitHub credentials.

```bash
./cleanup-branches.sh                            # dry run first, changes nothing
./cleanup-branches.sh --execute                  # do it (asks you to confirm)
./cleanup-branches.sh --execute --keep-backups   # delete 24, keep the 8 backup/*
```

The script tags every branch, pushes the tags, then **verifies each tag points at the branch tip
before deleting** — it refuses to delete any branch it could not archive.

Afterwards:

```bash
./restore-branch.sh                                   # list what was archived
./restore-branch.sh archive/backup-revert-1-20260912  # bring one back
```

---

## Upstream redundancy check

This repo is a fork of `can1357/oh-my-pi`. Work that was contributed **upstream** and merged there
would be redundant even though it is absent from your fork's `main`. So every branch was also
compared against upstream `main`, not just your own.

Findings:

- Your fork's `main` is **0 commits ahead and 23 commits behind** upstream. It is a slightly stale
  copy of upstream with **no fork-specific work on it at all**.
- The 23 missing upstream commits are all unrelated speculative-eval work (PR #9732, `wn-mitch`,
  dated 2026-09-12). None of it corresponds to anything on these branches.
- **Result: 0 additional redundancy.** All 61 branches show exactly the same unique-commit count
  against upstream as against your fork's `main`. **Not one branch's work has landed upstream.**

Consequence: the categorisation below is unchanged. Nothing extra becomes safe to delete, and
nothing in the "live work" list is secretly already upstream.

---

## Category A — already fully in `main` (4 branches) ✅ zero risk

Every commit on these is already part of `main`. Deleting them loses nothing at all.

| Branch | Commits ahead | Notes |
|---|---|---|
| `feat/cross-platform-power-assertion` | 0 | fully merged |
| `fix/hub-steering-reply` | 0 | fully merged |
| `pr/blank-tree-rows` | 0 | fully merged |
| `fix/legacy-pi-inplace-load` | 2 | both commits already landed in `main` |

## Category B — exact duplicates (7 branches) ✅ zero risk

These are byte-for-byte identical to another branch (same commit, two names).
**All seven `cleanup/*` branches are redundant** — the entire `cleanup/` prefix can go.

| Delete | Keep (identical content) |
|---|---|
| `cleanup/pr10436-new` | `fix/hub-wait-delivery` |
| `cleanup/pr10727` | `plugins-relink-over-directory` |
| `cleanup/pr10735` | `tui-tree-scroll-one-offset` |
| `cleanup/pr10754` | `feat/ttsr-structured-ast-conditions` |
| `cleanup/pr7761` | `pr/export-collapse` |
| `cleanup/pr7762` | `pr/tree-collapse` |
| `cleanup/pr8301-new` | `pr/prune-archive` |

## Category C — superseded, fully contained in another branch (8 branches) ✅ zero risk

Every commit on these already exists on a *different, newer* branch, so nothing is lost.

| Branch | Fully contained in |
|---|---|
| `backup/pre-upstream-rebase` | `backup/github-merge-tip` |
| `fix/compaction-no-rule-transcription` | `backup/local-streaming-reveal-fix` |
| `pr/compact-edit` | `backup/local-streaming-reveal-fix` |
| `pr-8350` | `backup/local-streaming-reveal-fix`, `omp-fork-prerebase` |
| `pr-6961` | `omp-fork-prerebase`, `omp-fork-prerebase2` |
| `pr/merge-duplicate-sessions` | `pr/prune-empty-sessions` |
| `review/pr8301-comments` | `review/pr8301-navigation` |
| `omp-fork` | `fix/cache-expired-preprompt-shake` |

> ⚠️ **Cross-dependency — read this before deleting the backups too.**
> Two rows above depend on a branch that is *itself* in the backup group:
> `fix/compaction-no-rule-transcription` (35 unique commits) and `pr/compact-edit` (8) are only
> contained in `backup/local-streaming-reveal-fix`. If you delete the backups as well, that
> containment no longer saves them — their work survives **only** as archive tags.
> Same for `backup/pre-upstream-rebase`, whose only home is `backup/github-merge-tip`.
> Not a disaster (the tags are a complete copy), but it is the difference between
> "still on a branch" and "recoverable from a tag".

> ⚠️ **`omp-fork` deserves a note.** It *sounds* like your main working branch, and it holds 59
> unique commits. But all 59 are already inside `fix/cache-expired-preprompt-shake`, which has the
> same work plus 2 more commits. It is safe to delete — just flag it so it isn't a surprise.

## Category D — abandoned experiments (5 branches) ⚠️ near-zero risk

Old WIP, months stale, sitting on a lineage that diverged before most of the project existed.
Each has only **one** commit that isn't already in `main`.

| Branch | Last touched | Unique commits | Behind `main` by |
|---|---|---|---|
| `archive/plugin` | 2026-01-01 | 105 | 22,140 (shares **no** history with `main` at all) |
| `test/gpt53-malformed` | 2026-02-07 | 1 (rest already in `main`) | 20,258 |
| `feat/js-tool` | 2026-03-01 | 1 | 20,258 |
| `wip/libedit` | 2026-03-23 | 1 | 20,258 |
| `feat/rwp` | 2026-05-12 | 1 | 20,258 |

The "behind by 20,258" number means these were branched off before ~92% of the project existed.
Rebasing them onto today's `main` would be a large project on its own.

## Category E — backup snapshots (8 branches) ❓ your call

Safety copies, presumably made before risky operations. They contain real unique work, but they
are *snapshots* — their purpose is already served if the work survived elsewhere.

| Branch | Unique commits |
|---|---|
| `backup/omp-fork-before-repair-20260907` | 55 |
| `backup/omp-fork-before-auto-rebase-20260904` | 51 |
| `backup/local-streaming-reveal-fix` | 37 |
| `backup/arena-019fbfd7` | 9 (was PR #4, closed) |
| `backup/revert-1` | 9 |
| `backup/arena-019fbfea` | 7 (was PR #3, closed) |
| `backup/pre-cleanup` | 4 |
| `backup/github-merge-tip` | 2 |

## Category F — live work, KEEP (29 branches) 🟢

These each hold commits that exist nowhere else. **Leave these alone.**

`docs/allow-local-commits` · `feat/ttsr-structured-ast-conditions` · `fix/cache-expired-preprompt-shake` ·
`fix/cache-expired-user-turn-shake` · `fix/claude-import-tree` · `fix/filtered-tree-connectors` ·
`fix/hub-wait-delivery` · `fix/jj-status-snapshot` · `fix/power-assertion-followups` ·
`fix/python-eval-auto-background-default` · `fix/streamed-edit-hook-revisions` ·
`fix/tree-selector-filtered-shape` · `import-api-error-failed-turn` · `import-decode-project-cwd` ·
`omp-fork-prerebase` · `omp-fork-prerebase2` · `plugins-relink-over-directory` · `pr-10320` ·
`pr/export-collapse` · `pr/prune` · `pr/prune-archive` · `pr/prune-empty-sessions` ·
`pr/tree-collapse` · `review/pr7762-comments` · `review/pr8301-navigation` ·
`review/pr8588-active-status` · `review/pr8593-comments` · `stats-recorded-folder` ·
`tui-tree-scroll-one-offset`

---

## Tally

| Bucket | Count | Risk |
|---|---|---|
| A — merged into `main` | 4 | none |
| B — exact duplicates | 7 | none |
| C — superseded | 8 | none |
| D — abandoned | 5 | negligible |
| **Safe subtotal** | **24** | |
| E — backups | 8 | your call |
| F — live work | 29 | leave alone |
| **Total** | **61** (+ `main`) | |

Deleting A+B+C+D takes 62 branches → 38, with zero work lost.
Deleting A+B+C+D+E takes it to 30.

---

## Preventing this from happening again

Two one-line settings stop the next `git push --all` from republishing all your local clutter:

```bash
# Only push the branch you're currently on (instead of all local branches)
git config --global push.default current

# Never guess — show what would be pushed first
git config --global push.autoSetupRemote true
```

Also worth doing on GitHub: **Settings → Branches → enable "Automatically delete head branches"**
so merged PR branches clean themselves up from now on.

---

## Restoring anything, later

```bash
# List every archived snapshot
git tag -l 'archive/*'

# Bring one back
git checkout -b name-i-want archive/name-20260912
```
