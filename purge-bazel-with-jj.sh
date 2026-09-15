#!/usr/bin/env bash
# =============================================================================
# purge-bazel-with-jj.sh — rewrite the affected branches with jj
# =============================================================================
#
# This is the dangerous alternative to remove-bazel-symlink.sh. It removes the
# bazel-oh-my-pi path from the reachable history of every remote branch that
# currently contains it. Every commit after the accidental add is restacked by
# jj, so all of those commit IDs change.
#
# The script operates in a temporary clone, not in the user's working tree.
# It creates and pushes an archive tag for every old branch tip before changing
# any branch. The archive tags intentionally preserve the old history.
#
# Default: dry run. The only way to rewrite branches is:
#
#   export JJ_EMAIL="12345678+your-github-login@users.noreply.github.com"
#   ./purge-bazel-with-jj.sh --execute
#
# A successful run uses `jj git push`, not git push --force. jj verifies that the
# remote branch still has the expected old value before moving it sideways.
#
# This script requires a recent jj (the commands were written for jj 0.45.x).
# It has not been executable-tested in this repository because jj is not
# available in the development sandbox. Test with the default dry run first.
#
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${REMOTE:-origin}"
TARGET="bazel-oh-my-pi"
MODE="dry-run"
YES="no"

usage() {
  sed -n '3,27p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --execute       Perform the rewrite in a temporary clone and push branches.
  --yes           Skip the final "REWRITE HISTORY" confirmation.
  --remote NAME   Use a remote other than origin.
  -h, --help      Show this help.

Required for --execute:
  JJ_EMAIL        A GitHub no-reply address, for example
                  12345678+your-login@users.noreply.github.com
  JJ_USER         Optional author/committer name; defaults to git user.name.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) MODE="execute" ;;
    --yes)     YES="yes" ;;
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

if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
  die "this is a shallow clone; run 'git fetch --unshallow $REMOTE' first"
fi

REMOTE_URL="$(git remote get-url "$REMOTE")"
STAMP="$(date +%Y%m%d-%H%M%S)"

refresh_refs() {
  git config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
  git fetch --prune --no-tags "$REMOTE" >/dev/null
}

find_affected() {
  AFFECTED=()
  ADD_COMMITS=()

  while IFS= read -r branch; do
    [[ -z "$branch" || "$branch" == HEAD ]] && continue
    [[ "$branch" == main || "$branch" == master ]] && continue

    if ! git cat-file -e "$REMOTE/$branch:$TARGET" 2>/dev/null; then
      continue
    fi

    mapfile -t adds < <(git log --format='%H' --diff-filter=A "$REMOTE/$branch" -- "$TARGET")
    [[ "${#adds[@]}" -eq 1 ]] || {
      echo "ERROR: expected exactly one add commit for $branch, found ${#adds[@]}" >&2
      exit 1
    }

    AFFECTED+=("$branch")
    ADD_COMMITS+=("${adds[0]}")
  done < <(git for-each-ref --format='%(refname:strip=3)' "refs/remotes/$REMOTE")
}

refresh_refs
find_affected

if [[ "${#AFFECTED[@]}" -eq 0 ]]; then
  echo "No remote branch currently contains '$TARGET'. Nothing to do."
  exit 0
fi

echo "Branches whose reachable history will be rewritten:"
for i in "${!AFFECTED[@]}"; do
  branch="${AFFECTED[$i]}"
  tip="$(git rev-parse "$REMOTE/$branch")"
  printf '  %-42s add %s   tip %s\n' "$branch" "${ADD_COMMITS[$i]:0:12}" "${tip:0:12}"
done

echo
echo "This will:"
echo "  1. create archive/bazel-prepurge-* tags for the old tips"
echo "  2. rewrite the add commit and all descendants with jj"
echo "  3. force-update the listed remote branches through jj"
echo
echo "The archive tags intentionally keep the old history recoverable."

if [[ "$MODE" == dry-run ]]; then
  echo
echo "DRY RUN: nothing changed. Re-run with --execute to continue."
  exit 0
fi

command -v jj >/dev/null 2>&1 || die "jj is required for --execute"
[[ -n "${JJ_EMAIL:-}" ]] || die "set JJ_EMAIL to your GitHub no-reply address before --execute"
JJ_USER="${JJ_USER:-$(git config user.name || true)}"
[[ -n "$JJ_USER" ]] || die "set JJ_USER or configure git user.name before --execute"

if [[ "$YES" != yes ]]; then
  echo
  printf 'Type exactly "REWRITE HISTORY" to continue: '
  read -r confirmation
  [[ "$confirmation" == "REWRITE HISTORY" ]] || { echo "Aborted."; exit 1; }
fi

TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/purge-bazel-jj.XXXXXX")"
cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

WORK="$TMPROOT/repo"
echo
echo "Cloning a temporary working copy into $WORK"
git clone --no-local --no-tags "$PWD" "$WORK" >/dev/null
# The local clone is only used to avoid downloading objects twice. Pushes still
# go to the user's real remote.
git -C "$WORK" remote set-url "$REMOTE" "$REMOTE_URL"
git -C "$WORK" config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
git -C "$WORK" fetch --prune --no-tags "$REMOTE" >/dev/null

(
  cd "$WORK"
  jj git init --colocate >/dev/null
  jj config set --repo user.name "$JJ_USER"
  jj config set --repo user.email "$JJ_EMAIL"
  jj git fetch --remote "$REMOTE" >/dev/null

  for i in "${!AFFECTED[@]}"; do
    branch="${AFFECTED[$i]}"
    target_add="${ADD_COMMITS[$i]}"
    old_tip="$(git rev-parse "$REMOTE/$branch")"
    tag="archive/bazel-prepurge-${branch//\//-}-$STAMP"

    # Re-check the branch and reserve its safety tag before modifying anything.
    git cat-file -e "$REMOTE/$branch:$TARGET" || die "$branch changed while preparing"
    if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$tag" >/dev/null 2>&1; then
      die "safety tag already exists: $tag"
    fi
    git tag "$tag" "$old_tip"
    git push "$REMOTE" "refs/tags/$tag" >/dev/null
    echo "[$branch] safety tag pushed: $tag"

    # Create/move a local bookmark to the fetched remote tip. The remote
    # bookmark is deliberately tracked only after the rewrite so that we can
    # resolve the expected old-vs-new bookmark divergence explicitly.
    jj bookmark set "$branch" --revision "$branch@$REMOTE" --allow-backwards
    jj new "$target_add" >/dev/null
    rm -- "$TARGET"
    jj squash --ignore-immutable >/dev/null
    jj git export >/dev/null

    new_tip="$(git rev-parse "refs/heads/$branch")"
    if git cat-file -e "$new_tip:$TARGET" 2>/dev/null; then
      die "rewrite failed: $branch still contains $TARGET at its tip"
    fi
    if [[ -n "$(git log "$new_tip" --oneline -- "$TARGET")" ]]; then
      die "rewrite failed: $TARGET still appears in $branch history"
    fi

    # Tracking the old remote bookmark can create a two-target bookmark. Set
    # the local target back to the newly rewritten tip, exactly as the manual
    # jj workflow requires, then let jj perform its guarded sideways push.
    jj bookmark track "$branch@$REMOTE" >/dev/null
    jj bookmark set "$branch" --revision "$new_tip" --allow-backwards
    jj git push --remote "$REMOTE" --bookmark "$branch"

    pushed="$(git ls-remote "$REMOTE" "refs/heads/$branch" | awk '{print $1}')"
    [[ "$pushed" == "$new_tip" ]] || die "remote verification failed for $branch"
    echo "[$branch] rewritten and verified at ${new_tip:0:12}"
  done
)

echo
echo "DONE: rewritten ${#AFFECTED[@]} branch(es)."
echo "The archive/bazel-prepurge-* tags preserve the old histories."
