#!/usr/bin/env bash
# =============================================================================
#  restore-branch.sh — bring back a branch archived by cleanup-branches.sh
# =============================================================================
#
#  USAGE
#    ./restore-branch.sh                                  # list everything archived
#    ./restore-branch.sh archive/backup-revert-1-20260912 # restore that one
#    ./restore-branch.sh archive/backup-revert-1-20260912 my-new-name
#
#  Nothing is pushed to GitHub unless you explicitly ask at the end.
#
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${REMOTE:-origin}"
MANIFEST="branch-archive-manifest.txt"

list_archived() {
  echo
  echo "Archived branches"
  echo "================="
  if [ -f "$MANIFEST" ] && [ -s "$MANIFEST" ]; then
    printf '  %-50s %-45s %s\n' "TAG" "ORIGINAL BRANCH" "COMMIT"
    while IFS=$'\t' read -r tag br sha; do
      [ -z "${tag:-}" ] && continue
      printf '  %-50s %-45s %s\n' "$tag" "$br" "${sha:0:10}"
    done < "$MANIFEST"
  else
    echo "  (no manifest found — listing archive/* tags instead)"
    git tag -l 'archive/*' | sed 's/^/  /'
  fi
  echo
  echo "Restore one with:"
  echo "  ./restore-branch.sh <tag>"
  echo
  exit 0
}

[ $# -eq 0 ] && list_archived

TAG="$1"
NEWNAME="${2:-}"

# if the manifest knows the original branch name, use it
if [ -z "$NEWNAME" ] && [ -f "$MANIFEST" ]; then
  NEWNAME="$(awk -F'\t' -v t="$TAG" '$1==t {print $2; exit}' "$MANIFEST" || true)"
fi

# last resort: derive a name from the tag
if [ -z "$NEWNAME" ]; then
  NEWNAME="${TAG#archive/}"
  NEWNAME="${NEWNAME%-20[0-9][0-9][0-9][0-9][0-9][0-9]}"
fi

echo "==> Fetching tags from $REMOTE"
git fetch "$REMOTE" --tags >/dev/null 2>&1 || true

if ! git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo
  echo "    No such tag: $TAG"
  list_archived
fi

if git show-ref --verify --quiet "refs/heads/$NEWNAME"; then
  echo
  echo "    ERROR: a branch named '$NEWNAME' already exists."
  echo "    Pick a different name:"
  echo "      ./restore-branch.sh $TAG some-other-name"
  exit 1
fi

SHA="$(git rev-parse "refs/tags/$TAG")"
git branch "$NEWNAME" "$TAG"

echo
echo "============================================================================="
echo "  Restored '$TAG' as local branch '$NEWNAME' (${SHA:0:10})"
echo "============================================================================="
echo
echo "  Look at it:      git checkout $NEWNAME"
echo "  Diff vs main:    git diff origin/main...$NEWNAME --stat"
echo
echo "  To publish it back to GitHub:"
echo "      git push -u $REMOTE $NEWNAME"
echo
