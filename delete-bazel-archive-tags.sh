#!/usr/bin/env bash
# =============================================================================
# delete-bazel-archive-tags.sh — remove archive refs that contain the leaked path
# =============================================================================
#
# This deletes only archive/* tags whose reachable history contains the
# bazel-oh-my-pi path. It refuses to delete anything while an active remote
# branch still contains that path in its reachable history.
#
# Default: dry run. Execute with:
#   bash ./delete-bazel-archive-tags.sh --execute
#
# Deleting a tag removes the normal GitHub ref, but cannot erase copies already
# cloned by other people and does not guarantee immediate garbage collection of
# unreachable Git objects on GitHub.
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${REMOTE:-origin}"
TARGET="bazel-oh-my-pi"
MODE="dry-run"

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --execute       Delete the matching remote archive tags.
  --remote NAME   Use a remote other than origin.
  -h, --help      Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) MODE="execute" ;;
    --remote)
      [[ $# -ge 2 ]] || { echo "--remote needs a name" >&2; exit 2; }
      REMOTE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "ERROR: $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is not installed"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a Git repository"
git remote get-url "$REMOTE" >/dev/null 2>&1 || die "no remote named '$REMOTE'"

# Refresh branch refs, including forced updates, but do not change the working tree.
git config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
git fetch --prune --no-tags "$REMOTE" >/dev/null
git fetch --prune --no-tags "$REMOTE" "+refs/heads/*:refs/remotes/$REMOTE/*" >/dev/null

# The safety check is against all active branch history, not only branch tips.
BAD_BRANCHES=()
while IFS= read -r ref; do
  [[ "$ref" == "refs/remotes/$REMOTE/HEAD" ]] && continue
  if [[ -n "$(git log -1 --format='%H' "$ref" -- "$TARGET")" ]]; then
    BAD_BRANCHES+=("${ref#refs/remotes/$REMOTE/}")
  fi
done < <(git for-each-ref --format='%(refname)' "refs/remotes/$REMOTE")

if [[ "${#BAD_BRANCHES[@]}" -gt 0 ]]; then
  echo "ERROR: active branches still contain '$TARGET' in their history:" >&2
  printf '  %s\n' "${BAD_BRANCHES[@]}" >&2
  echo "Finish the history rewrite before deleting archive tags." >&2
  exit 1
fi

# Fetch each remote archive tag if this clone does not have its object yet, then
# identify tags whose reachable history still mentions the target path.
BAD_TAGS=()
while IFS= read -r tag; do
  [[ -z "$tag" ]] && continue
  if ! git show-ref --verify --quiet "refs/tags/$tag"; then
    git fetch "$REMOTE" "refs/tags/$tag:refs/tags/$tag" >/dev/null
  fi
  if [[ -n "$(git log -1 --format='%H' "refs/tags/$tag" -- "$TARGET")" ]]; then
    BAD_TAGS+=("$tag")
  fi
done < <(
  git ls-remote --tags "$REMOTE" 'refs/tags/archive/*' |
    awk '$2 !~ /\^\{\}$/ {sub("refs/tags/", "", $2); print $2}'
)

if [[ "${#BAD_TAGS[@]}" -eq 0 ]]; then
  echo "No archive tag contains '$TARGET'. Nothing to do."
  exit 0
fi

echo "Archive tags that contain '$TARGET' and will be removed:"
printf '  %s\n' "${BAD_TAGS[@]}"
echo
echo "Active branch histories are clean."

if [[ "$MODE" == dry-run ]]; then
  echo
echo "DRY RUN: nothing changed. Re-run with --execute to delete these remote tags."
  exit 0
fi

echo
printf 'Type exactly "DELETE BAZEL ARCHIVE TAGS" to continue: '
read -r confirmation
[[ "$confirmation" == "DELETE BAZEL ARCHIVE TAGS" ]] || { echo "Aborted."; exit 1; }

for tag in "${BAD_TAGS[@]}"; do
  echo "Deleting $REMOTE/$tag"
  git push "$REMOTE" --delete "$tag"
done

echo
echo "Deleted ${#BAD_TAGS[@]} remote archive tag(s)."
echo "Already-cloned copies and unreachable Git objects may still exist elsewhere."
