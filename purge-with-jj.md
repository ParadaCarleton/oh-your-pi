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
#    If the local bookmark already exists, skip this command. Colocated mode often
#    imports it automatically from Git.
git branch <BRANCH> origin/<BRANCH>  # skip if it says the branch already exists

# 1. Create a new change sitting directly on top of the commit that added the file
jj new <COMMIT_SHA>

# 2. Delete the file from the working copy
rm bazel-oh-my-pi

# 3. Fold that deletion back into the commit below it — this is the amend.
#    The commit is probably IMMUTABLE: it is reachable from a remote bookmark
#    and, in this repository, also from an archive tag. That protection is good
#    for normal work, but this operation intentionally rewrites history.
#    jj automatically restacks every descendant commit.
jj squash --ignore-immutable

# 4. LOOK at what you got before pushing anything
jj log -r '::<BRANCH>' --stat | head -40
git show <BRANCH>:bazel-oh-my-pi 2>&1 | head -1   # should say "does not exist"

# 5. Make jj track the existing remote branch before pushing it. If jj says it
#    is already tracked, that is fine. The @origin form is accepted by jj.
jj bookmark track <BRANCH>@origin

#    Because the remote still points at the OLD commit, tracking may report:
#      <BRANCH> (conflicted): ... <NEW_COMMIT> ... <OLD_COMMIT> ...
#    This is expected. First verify that <NEW_COMMIT> is the amended commit
#    (the one without bazel-oh-my-pi), then choose it explicitly:
jj bookmark set <BRANCH> --revision <NEW_COMMIT>
#    If your jj asks for a bookmark move instead:
# jj bookmark move --to <NEW_COMMIT> --allow-backwards <BRANCH>

# 6. Push. Once the bookmark is resolved, jj performs the safe force-update
#    needed for this rewrite (it checks that the remote did not change
#    unexpectedly while you were working).
jj git push --bookmark <BRANCH>
#    Older jj versions call --bookmark --branch:
# jj git push --branch <BRANCH>
```

### If GitHub reports `GH007: Your push would publish a private email address`

That means the rewritten commit was made with a private email from your local jj/git
configuration. Configure jj with the GitHub-generated no-reply address, then rewrite the
new commit's metadata before pushing again:

```bash
# Inspect the identity without pasting it into chat
git show -s --format='Author: %an <%ae>%nCommitter: %cn <%ce>' <NEW_COMMIT>

# This prints your GitHub no-reply address; review it before using it.
GH_EMAIL="$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
jj config set --repo user.email "$GH_EMAIL"

# Metadata changes create another commit ID; that is expected.
jj metaedit --update-author <NEW_COMMIT>

# The local bookmark follows the rewritten commit.
jj git push --bookmark <BRANCH>
```

Do not disable GitHub's email-privacy protection unless you deliberately want your private
email recorded in the public repository. The no-reply address is the safer choice.

Undo at any point: `jj undo` reverts the last jj operation.

Verify afterwards (for the branch you just rewrote):

```bash
git log <BRANCH> --oneline -- bazel-oh-my-pi    # should print nothing
```

If `git log --all --oneline -- bazel-oh-my-pi` still prints the old add commit, check whether
that result comes from an `archive/*` tag. That is expected: the archive tag is an intentional
snapshot of the pre-purge history. Removing the file from those snapshots too would require
deleting the safety tags, which I do not recommend.

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
