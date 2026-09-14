# Purging `bazel-oh-my-pi` from history with jj

⚠️ **Only do this if you want the symlink gone from history entirely.**
The safe alternative (`./remove-bazel-symlink.sh --execute`) already removed it from every branch
tip, and it is already in `.gitignore`. You probably do not need this.

**Not verified by me** — jj could not be installed in my sandbox, so I could not run this.
It is written as a reviewable sequence, not a script, so you can inspect each step.

---

## What we know

Exactly **one commit** added the file. On every branch it is the same logical commit —
`feat(session): add /prune to drop empty conversation branches` (2026-08-05). It has a different
SHA per branch only because of rebases:

| Branch | Commit that added it | Descendants rewritten |
|---|---|---|
| `pr/prune` | `c3002bf218` | **0** — it is the tip, so only 1 commit changes |
| `fix/cache-expired-preprompt-shake` | `d7f2a6502a` | 57 |
| `omp-fork-prerebase2` | `32cda238b9` | 56 |
| `omp-fork-prerebase` | `4e52956ba2` | 60 |

No other commit on any branch touches the file. So this is a single amend plus a restack — the
case jj handles best.

Note the add commit also contains the real `/prune` work (`session-manager.ts` +116, tests +315,
etc). Amending removes only the symlink from it; everything else in that commit is preserved.

**Start with `pr/prune`** — zero descendants, so it rewrites a single commit. It is the perfect
place to confirm the workflow does what you expect before touching the 57-descendant branch.

---

## Before you start

```bash
# jj colocated with your existing git repo
cd /path/to/oh-your-pi
jj git init --colocate
jj git fetch

# Safety net: tag the current tips so you can always get back
git tag pre-purge-$(date +%Y%m%d) fix/cache-expired-preprompt-shake 2>/dev/null || \
  git tag pre-purge-$(date +%Y%m%d) origin/fix/cache-expired-preprompt-shake
```

If anything goes wrong: `jj undo` reverts the last jj operation. It is genuinely good.

---

## Per branch

Repeat for each branch. Start with `pr/prune` (the least important) to confirm the workflow
behaves as you expect before touching `fix/cache-expired-preprompt-shake`.

```bash
# 0. Give jj a LOCAL branch to move (it cannot push a bare remote-tracking ref).
#    Colocated mode picks this up automatically on the next jj command.
git branch <BRANCH> origin/<BRANCH>

# 1. Create a new change sitting directly on top of the commit that added the file
jj new <COMMIT_SHA>

# 2. Delete the file from the working copy
rm bazel-oh-my-pi

# 3. Fold that deletion back into the commit below it — this is the amend.
#    jj automatically restacks every descendant commit.
jj squash

# 4. LOOK at what you got before pushing anything
jj log -r '::<BRANCH>' --stat | head -40
git show <BRANCH>:bazel-oh-my-pi 2>&1 | head -1   # should say "does not exist"

# 5. Push. jj knows it just rewrote these commits, so it may not need --force.
jj git push --branch <BRANCH>
#   if jj refuses with a non-fast-forward error, add --force:
jj git push --branch <BRANCH> --force
```

Undo at any point: `jj undo` reverts the last jj operation.

Verify afterwards:

```bash
git log --all --oneline -- bazel-oh-my-pi    # should return nothing
```

---

## If you only want to do one branch

Realistically **`fix/cache-expired-preprompt-shake` is the only one that matters.** The other three
(`omp-fork-prerebase`, `omp-fork-prerebase2`, `pr/prune`) are in the round-2 delete list and are
about to be archived and removed anyway. Cleaning history on branches you are about to delete is
wasted effort — and their archive tags will preserve the old history regardless.

---

## After purging

- The 32 `archive/*-20260912` tags still point at pre-purge commits. They remain valid snapshots
  and are unaffected — leaving them is fine and is the safer choice.
- `fix/cache-expired-preprompt-shake` will have rewritten SHAs, so any local clone of it needs
  `jj git fetch` / `git fetch` plus a reset.
- Expect the rewrite to make the branch diverge a little further from upstream when you next sync.
