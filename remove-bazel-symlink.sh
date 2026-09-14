#!/usr/bin/env bash
# =============================================================================
#  remove-bazel-symlink.sh — delete the stray `bazel-oh-my-pi` symlink
# =============================================================================
#
#  WHAT THIS IS
#  ------------
#  Four branches accidentally commit a file named `bazel-oh-my-pi`. It is a
#  symlink (git mode 120000) whose entire contents are one developer's absolute
#  local path:
#
#      /home/lime/.cache/bazel/_bazel_lime/<hash>/execroot/_main
#
#  It is a Bazel convenience symlink that should never have been committed.
#  It is NOT in main, NOT in upstream, and it is ALREADY LISTED IN .gitignore
#  (line 93: /bazel-oh-my-pi) — so once deleted it will not come back.
#
#  WHAT THIS SCRIPT DOES (default, safe)
#  -------------------------------------
#  On every branch that contains the file, it makes one new commit that deletes
#  it, and pushes that commit. Nothing is rewritten, no history is changed, no
#  force-push, nothing can break. Your working tree is never touched.
#
#  USAGE
#  -----
#    ./remove-bazel-symlink.sh                 # dry run — shows what it would do
#    ./remove-bazel-symlink.sh --execute       # do it
#    ./remove-bazel-symlink.sh --purge-history # DANGEROUS, see below
#
#  ABOUT --purge-history
#  ---------------------
#  The default leaves the symlink in the branch's PAST commits — it just removes
#  it from the tip. For a symlink to a local cache path that is fine, and it is
#  what I recommend.
#
#  --purge-history rewrites the entire history of those branches so the file
#  never existed. That changes every commit hash on those branches, requires a
#  force-push, and breaks the archive/* tags that point at the old commits.
#  Only use it if you consider the leaked path sensitive. It needs
#  `git filter-repo` installed, and it will refuse to run without confirmation.
#
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${REMOTE:-origin}"
TARGET="bazel-oh-my-pi"
MODE="dry-run"
PURGE="no"
PROTECTED=("main" "master")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)        MODE="execute" ;;
    --purge-history)  PURGE="yes" ;;
    -h|--help)        sed -n '3,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done

echo "==> 1. Checking repository"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "    Not a git repository."; exit 1; }
git remote get-url "$REMOTE" >/dev/null 2>&1 || { echo "    No remote named '$REMOTE'."; exit 1; }
echo "    remote: $(git remote get-url "$REMOTE")"
echo "    mode  : $MODE"

# -----------------------------------------------------------------------------
echo
echo "==> 2. Refreshing branch list"
git config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
if [ -f "$(git rev-parse --git-dir)/shallow" ]; then
  echo "    shallow clone — deepening..."
  git fetch --unshallow --no-tags "$REMOTE" >/dev/null 2>&1 || true
fi
git fetch --no-tags --prune "$REMOTE" >/dev/null 2>&1 || true
echo "    $(git branch -r --format='%(refname:short)' | grep -c "^$REMOTE/" || true) remote branches visible"

# -----------------------------------------------------------------------------
echo
echo "==> 3. Finding branches that contain '$TARGET'"
AFFECTED=()
while IFS= read -r b; do
  [ -z "$b" ] && continue
  skip="no"
  for p in "${PROTECTED[@]}"; do [ "$b" = "$p" ] && skip="yes"; done
  [ "$skip" = "yes" ] && continue
  if git cat-file -e "$REMOTE/$b:$TARGET" 2>/dev/null; then
    AFFECTED+=("$b")
  fi
done < <(git branch -r --format='%(refname:short)' | sed "s|^$REMOTE/||" | grep -v '^HEAD$')

if [ "${#AFFECTED[@]}" -eq 0 ]; then
  echo "    No branch contains '$TARGET'. Nothing to do."
  exit 0
fi
for b in "${AFFECTED[@]}"; do
  mode=$(git ls-tree "$REMOTE/$b" "$TARGET" | awk '{print $1}')
  echo "    FOUND: $b   (mode $mode)"
done

# -----------------------------------------------------------------------------
echo
echo "==> 4. Confirmation"
if [ "$MODE" = "dry-run" ]; then
  echo "    DRY RUN — nothing changed."
  echo
  echo "    This will add ONE deletion commit to each of the ${#AFFECTED[@]} branches above."
  echo "    Re-run with --execute to do it."
  exit 0
fi
if [ "$PURGE" = "no" ]; then
  printf '    Add a deletion commit to %d branches and push? Type "yes": ' "${#AFFECTED[@]}"
  read -r reply
  [ "$reply" = "yes" ] || { echo "    Aborted."; exit 1; }
fi

# -----------------------------------------------------------------------------
if [ "$PURGE" = "yes" ]; then
  echo
  echo "==> 5. HISTORY REWRITE (--purge-history)"
  if ! command -v git-filter-repo >/dev/null 2>&1; then
    echo "    git-filter-repo is not installed."
    echo "      pip install git-filter-repo      (or: brew install git-filter-repo)"
    exit 1
  fi
  echo "    This rewrites ALL history on these branches:"
  printf '      %s\n' "${AFFECTED[@]}"
  echo
  echo "    Consequences: every commit hash changes, a FORCE-PUSH is required,"
  echo "    and the archive/* tags pointing at old commits will no longer match."
  echo
  printf '    To proceed type "REWRITE HISTORY": '
  read -r reply
  [ "$reply" = "REWRITE HISTORY" ] || { echo "    Aborted."; exit 1; }

  echo
  echo "    Rewriting with --invert-paths --path $TARGET ..."
  git filter-repo --invert-paths --path "$TARGET" --force
  echo "    Rewritten locally. Now force-push each branch:"
  for b in "${AFFECTED[@]}"; do
    echo "      git push --force-with-lease $REMOTE $b"
  done
  echo
  echo "    (pushing is left to you on purpose — check the result first with 'git log')"
  exit 0
fi

# -----------------------------------------------------------------------------
echo
echo "==> 5. Adding a deletion commit to each branch"
TMPROOT="$(mktemp -d)"
cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

for b in "${AFFECTED[@]}"; do
  wt="$TMPROOT/$(echo "$b" | tr '/' '-')"
  echo "  -- $b"
  if ! git worktree add --detach -q "$wt" "$REMOTE/$b" 2>/dev/null; then
    echo "      could not create worktree — skipping"
    continue
  fi
  if ! (cd "$wt" && git rm -q "$TARGET" 2>/dev/null); then
    echo "      file not present at tip — skipping"
    git worktree remove --force "$wt" >/dev/null 2>&1 || true
    continue
  fi
  (cd "$wt" && git commit -q -m "chore: remove accidentally committed $TARGET symlink

Bazel created this convenience symlink pointing at an absolute local cache
path. It should never have been committed; it is already covered by
.gitignore (/bazel-oh-my-pi), so removing it is enough.")
  newsha="$(git -C "$wt" rev-parse HEAD)"
  if (cd "$wt" && git push -q "$REMOTE" "HEAD:refs/heads/$b" 2>/dev/null); then
    echo "      committed ${newsha:0:10} and pushed"
  else
    echo "      committed ${newsha:0:10} but PUSH FAILED — push it manually:"
    echo "        git push $REMOTE $newsha:refs/heads/$b"
  fi
  git worktree remove --force "$wt" >/dev/null 2>&1 || true
done

# -----------------------------------------------------------------------------
echo
echo "============================================================================="
echo "  DONE"
echo "============================================================================="
echo "  Removed '$TARGET' from ${#AFFECTED[@]} branches:"
printf '    %s\n' "${AFFECTED[@]}"
echo
echo "  The file stays in those branches' PAST commits. It is already in"
echo "  .gitignore, so it will not be re-added."
echo
echo "  To also erase it from history entirely (rewrites hashes, force-push):"
echo "      ./remove-bazel-symlink.sh --purge-history"
echo
