#!/usr/bin/env bash
# =============================================================================
#  cleanup-branches.sh — archive and delete the dead branches in oh-your-pi
# =============================================================================
#
#  PLAIN ENGLISH
#  -------------
#  Your `git push --all` published every branch that existed on your laptop.
#  This script removes the 32 that are dead: already merged into main, exact
#  duplicates of another branch, superseded by a newer branch, abandoned
#  experiments, and old backup snapshots.
#
#  Before removing ANY branch, it saves that branch as a permanent git tag
#  (think: a bookmark that never expires) and pushes the tag to GitHub. If a
#  tag cannot be created, or does not point at exactly the right commit, the
#  script REFUSES to delete that branch. Nothing can be lost.
#
#  USAGE
#  -----
#    ./cleanup-branches.sh                           # dry run — changes nothing
#    ./cleanup-branches.sh --execute                 # do it — asks to confirm
#    ./cleanup-branches.sh --execute --yes           # do it — no prompt
#    ./cleanup-branches.sh --execute --keep-backups  # delete 24, keep the 8 backup/*
#
#  AFTERWARDS, to bring any branch back:
#    ./restore-branch.sh                             # list what was archived
#    ./restore-branch.sh archive/backup-revert-1-20260912
#
# =============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REMOTE="${REMOTE:-origin}"
STAMP="${STAMP:-$(date +%Y%m%d)}"
TAG_PREFIX="archive"
MANIFEST="branch-archive-manifest.txt"

MODE="dry-run"
ASSUME_YES="no"
KEEP_BACKUPS="no"

usage() {
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)      MODE="execute" ;;
    --yes|-y)       ASSUME_YES="yes" ;;
    --keep-backups) KEEP_BACKUPS="yes" ;;
    -h|--help)      usage ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done

# -----------------------------------------------------------------------------
# The 24 branches that are provably dead
# -----------------------------------------------------------------------------
CORE_SAFE=(
  # -- every commit already lives in main -----------------------------------
  feat/cross-platform-power-assertion
  fix/hub-steering-reply
  pr/blank-tree-rows
  fix/legacy-pi-inplace-load
  # -- byte-for-byte identical to a better-named branch ---------------------
  cleanup/pr10436-new
  cleanup/pr10727
  cleanup/pr10735
  cleanup/pr10754
  cleanup/pr7761
  cleanup/pr7762
  cleanup/pr8301-new
  # -- superseded: all commits already on a newer branch --------------------
  backup/pre-upstream-rebase
  fix/compaction-no-rule-transcription
  pr/compact-edit
  pr-8350
  pr-6961
  pr/merge-duplicate-sessions
  review/pr8301-comments
  omp-fork
  # -- abandoned experiments, untouched for months --------------------------
  archive/plugin
  test/gpt53-malformed
  feat/js-tool
  wip/libedit
  feat/rwp
)

# -----------------------------------------------------------------------------
# The 8 backup snapshots.
# NOTE: these contain work that exists NOWHERE else. They are the one genuinely
# debatable group. Use --keep-backups to leave them alone.
# -----------------------------------------------------------------------------
BACKUP_BRANCHES=(
  backup/omp-fork-before-repair-20260907
  backup/omp-fork-before-auto-rebase-20260904
  backup/local-streaming-reveal-fix
  backup/arena-019fbfd7
  backup/revert-1
  backup/arena-019fbfea
  backup/pre-cleanup
  backup/github-merge-tip
)

TO_DELETE=("${CORE_SAFE[@]}")
if [ "$KEEP_BACKUPS" = "no" ]; then
  TO_DELETE+=("${BACKUP_BRANCHES[@]}")
fi

tagname() { printf '%s/%s-%s' "$TAG_PREFIX" "$(printf '%s' "$1" | tr '/' '-')" "$STAMP"; }

# if MODE is dry-run, just print the command instead of running it
run() {
  if [ "$MODE" = "execute" ]; then "$@"; else printf '    [dry-run] %s\n' "$*"; fi
}

# -----------------------------------------------------------------------------
echo "==> 1. Checking repository"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "    Not a git repository."; exit 1; }
git remote get-url "$REMOTE" >/dev/null 2>&1 || { echo "    No remote named '$REMOTE'."; exit 1; }
CURRENT="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
echo "    remote      : $(git remote get-url "$REMOTE")"
echo "    on branch   : ${CURRENT:-<detached HEAD>}"
echo "    mode        : $MODE"
echo "    keep backups: $KEEP_BACKUPS"

# -----------------------------------------------------------------------------
echo
echo "==> 2. Making sure every remote branch is visible locally"
git config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
if [ -f "$(git rev-parse --git-dir)/shallow" ]; then
  echo "    shallow clone detected — deepening (may take a few minutes)..."
  git fetch --unshallow --no-tags "$REMOTE" >/dev/null 2>&1 || true
fi
git fetch --no-tags --prune "$REMOTE" >/dev/null 2>&1 || true
echo "    $(git branch -r --format='%(refname:short)' | grep -c "^$REMOTE/" || true) remote branches visible"

# -----------------------------------------------------------------------------
echo
echo "==> 3. Validating the delete list"

# never touch main or whatever you are currently on
PROTECTED=("main" "master" "$CURRENT")
FILTERED=()
for b in "${TO_DELETE[@]}"; do
  skip="no"
  for p in "${PROTECTED[@]}"; do
    [ -n "$p" ] && [ "$b" = "$p" ] && skip="yes"
  done
  [ "$skip" = "yes" ] && continue
  if ! git rev-parse --verify --quiet "refs/remotes/$REMOTE/$b" >/dev/null; then
    echo "    WARNING: $REMOTE/$b does not exist — skipping"
    continue
  fi
  FILTERED+=("$b")
done
TO_DELETE=("${FILTERED[@]}")

# catch tag-name collisions (e.g. a/b-c vs a-b-c collapsing to the same tag)
declare -A SEEN=()
for b in "${TO_DELETE[@]}"; do
  t="$(tagname "$b")"
  if [ -n "${SEEN[$t]:-}" ]; then
    echo "    ERROR: tag name collision between '${SEEN[$t]}' and '$b' ($t)"
    exit 1
  fi
  SEEN[$t]="$b"
done

echo "    ${#TO_DELETE[@]} branches will be archived and deleted:"
for b in "${TO_DELETE[@]}"; do
  printf '      %-45s -> %s\n' "$b" "$(tagname "$b")"
done

# -----------------------------------------------------------------------------
echo
echo "==> 4. Confirmation"
if [ "$MODE" = "dry-run" ]; then
  echo "    DRY RUN — nothing has been changed."
  echo "    Re-run with --execute to make it happen."
  exit 0
fi
if [ "$ASSUME_YES" = "no" ]; then
  printf '    This will delete %d branches on %s. Type "yes" to continue: ' \
    "${#TO_DELETE[@]}" "$(git remote get-url "$REMOTE")"
  read -r reply
  [ "$reply" = "yes" ] || { echo "    Aborted."; exit 1; }
fi

# -----------------------------------------------------------------------------
echo
echo "==> 5. Archiving every branch as a permanent tag"
NEW_TAGS=()
for b in "${TO_DELETE[@]}"; do
  t="$(tagname "$b")"
  sha="$(git rev-parse "refs/remotes/$REMOTE/$b")"
  if git rev-parse --verify --quiet "refs/tags/$t" >/dev/null; then
    existing="$(git rev-parse "refs/tags/$t")"
    if [ "$existing" = "$sha" ]; then
      echo "    already archived: $t"
      continue
    fi
    echo "    ERROR: tag $t already exists but points somewhere else. Aborting."
    exit 1
  fi
  git tag "$t" "$sha"
  NEW_TAGS+=("$t")
  echo "    tagged $t  (${sha:0:10})"
done

if [ "${#NEW_TAGS[@]}" -gt 0 ]; then
  echo "    pushing ${#NEW_TAGS[@]} tags to $REMOTE..."
  git push "$REMOTE" "${NEW_TAGS[@]/#/refs/tags/}" >/dev/null
  echo "    tags pushed."
else
  echo "    (all tags already present on remote)"
fi

# -----------------------------------------------------------------------------
echo
echo "==> 6. Verifying each archive tag before we delete anything"
VERIFIED=()
FAILED=()
for b in "${TO_DELETE[@]}"; do
  t="$(tagname "$b")"
  bsha="$(git rev-parse "refs/remotes/$REMOTE/$b")"
  tsha="$(git rev-parse "refs/tags/$t" 2>/dev/null || echo '')"
  rsha="$(git ls-remote "$REMOTE" "refs/tags/$t" 2>/dev/null | awk '{print $1}' || echo '')"
  if [ "$bsha" != "$tsha" ] || [ -n "$rsha" ] && [ "$bsha" != "$rsha" ]; then
    echo "    UNSAFE — refusing to delete $b (tag mismatch)"
    FAILED+=("$b")
    continue
  fi
  VERIFIED+=("$b")
done
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo
  echo "    ${#FAILED[@]} branch(es) could not be archived and were NOT deleted:"
  printf '      %s\n' "${FAILED[@]}"
fi

# -----------------------------------------------------------------------------
echo
echo "==> 7. Deleting ${#VERIFIED[@]} verified branches on $REMOTE"
for b in "${VERIFIED[@]}"; do
  if git push "$REMOTE" --delete "$b" >/dev/null 2>&1; then
    echo "    deleted remote  $b"
  else
    echo "    FAILED remote   $b"
  fi
done

# -----------------------------------------------------------------------------
echo
echo "==> 8. Deleting local copies (if any exist)"
for b in "${VERIFIED[@]}"; do
  if git show-ref --verify --quiet "refs/heads/$b"; then
    if [ "$b" = "$CURRENT" ]; then
      echo "    skipped local   $b (that is your current branch)"
      continue
    fi
    git branch -D "$b" >/dev/null 2>&1 && echo "    deleted local   $b"
  fi
done

# -----------------------------------------------------------------------------
echo
echo "==> 9. Writing $MANIFEST"
: > "$MANIFEST"
for b in "${VERIFIED[@]}"; do
  t="$(tagname "$b")"
  printf '%s\t%s\t%s\n' "$t" "$b" "$(git rev-parse "refs/tags/$t")" >> "$MANIFEST"
done
echo "    $(wc -l < "$MANIFEST" | tr -d ' ') entries"

# -----------------------------------------------------------------------------
echo
echo "============================================================================="
echo "  DONE"
echo "============================================================================="
echo "  Branches deleted : ${#VERIFIED[@]}"
echo "  Archive tags     : archive/*-$STAMP  (on GitHub and locally)"
echo
REMAINING="$(git ls-remote --heads "$REMOTE" 2>/dev/null | wc -l | tr -d ' ')"
echo "  Branches now on $REMOTE: $REMAINING"
echo
echo "  To bring any branch back:"
echo "      ./restore-branch.sh                      # list what was archived"
echo "      ./restore-branch.sh archive/<name>-$STAMP"
echo
echo "  Suggestion — stop this from recurring:"
echo "      git config --global push.default current"
echo
