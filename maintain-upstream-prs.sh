#!/usr/bin/env bash
# =============================================================================
# maintain-upstream-prs.sh — audit/rebase/open PRs against can1357/oh-my-pi
# =============================================================================
#
# This is for PRs whose base is the upstream project, not the user's fork.
# It uses a temporary clone, so the user's working tree and staged files are
# not touched.
#
#   bash ./maintain-upstream-prs.sh --audit
#   bash ./maintain-upstream-prs.sh --rebase fix/streamed-edit-hook-revisions
#   bash ./maintain-upstream-prs.sh --open BRANCH --title "Title"
#
# Rebase pushes use force-with-lease and stop rather than guessing at conflicts.
# =============================================================================
set -euo pipefail

REMOTE="${REMOTE:-origin}"
UPSTREAM="${UPSTREAM:-upstream}"
UPSTREAM_REPO="${UPSTREAM_REPO:-can1357/oh-my-pi}"
MODE="audit"
BRANCH=""
TITLE=""
BODY=""
KEEP_TEMP="no"

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --audit             List your open PRs to upstream (default).
  --rebase BRANCH     Rebase a fork branch onto upstream/main and update it.
  --open BRANCH       Open a new PR from a fork branch to upstream/main.
  --title TEXT        Title for --open.
  --body TEXT         Body for --open.
  --keep-temp         Keep the temporary clone if a rebase conflicts.
  --remote NAME       Fork remote (default: origin).
  --upstream NAME     Upstream remote (default: upstream).
  -h, --help          Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --audit) MODE="audit" ;;
    --rebase) [[ $# -ge 2 ]] || { echo "--rebase needs a branch" >&2; exit 2; }; MODE="rebase"; BRANCH="$2"; shift ;;
    --open) [[ $# -ge 2 ]] || { echo "--open needs a branch" >&2; exit 2; }; MODE="open"; BRANCH="$2"; shift ;;
    --title) [[ $# -ge 2 ]] || { echo "--title needs text" >&2; exit 2; }; TITLE="$2"; shift ;;
    --body) [[ $# -ge 2 ]] || { echo "--body needs text" >&2; exit 2; }; BODY="$2"; shift ;;
    --keep-temp) KEEP_TEMP="yes" ;;
    --remote) [[ $# -ge 2 ]] || { echo "--remote needs a name" >&2; exit 2; }; REMOTE="$2"; shift ;;
    --upstream) [[ $# -ge 2 ]] || { echo "--upstream needs a name" >&2; exit 2; }; UPSTREAM="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "ERROR: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || die "git is not installed"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a Git repository"
git remote get-url "$REMOTE" >/dev/null 2>&1 || die "no remote named '$REMOTE'"
git remote get-url "$UPSTREAM" >/dev/null 2>&1 || die "no remote named '$UPSTREAM'"

if [[ "$MODE" == audit ]]; then
  command -v gh >/dev/null 2>&1 || die "gh is required for --audit"
  gh pr list --repo "$UPSTREAM_REPO" --state open --limit 100 \
    --search 'author:ParadaCarleton' \
    --json number,title,headRefName,mergeStateStatus,url \
    --jq '.[] | "#\(.number)\t\(.mergeStateStatus)\t\(.headRefName)\t\(.url)"'
  exit 0
fi

if [[ "$MODE" == open ]]; then
  command -v gh >/dev/null 2>&1 || die "gh is required for --open"
  [[ -n "$TITLE" ]] || die "--title is required with --open"
  git ls-remote --exit-code --heads "$REMOTE" "refs/heads/$BRANCH" >/dev/null 2>&1 || \
    die "$REMOTE/$BRANCH does not exist"
  gh pr create --repo "$UPSTREAM_REPO" \
    --head "ParadaCarleton:$BRANCH" \
    --base main \
    --title "$TITLE" \
    --body "${BODY:-This PR was prepared from the ParadaCarleton fork.}"
  exit 0
fi

# --rebase mode
ORIGIN_URL="$(git remote get-url "$REMOTE")"
UPSTREAM_URL="$(git remote get-url "$UPSTREAM")"
OLD_SHA="$(git ls-remote "$ORIGIN_URL" "refs/heads/$BRANCH" | awk '{print $1}')"
[[ -n "$OLD_SHA" ]] || die "$REMOTE/$BRANCH does not exist on the fork"

GIT_EMAIL="${GIT_EMAIL:-}"
if [[ -z "$GIT_EMAIL" ]]; then
  command -v gh >/dev/null 2>&1 || die "set GIT_EMAIL to your GitHub no-reply address"
  GIT_EMAIL="$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')"
fi
GIT_NAME="${GIT_NAME:-$(git config user.name || true)}"
[[ -n "$GIT_NAME" ]] || die "set GIT_NAME or configure git user.name"

TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/upstream-pr.XXXXXX")"
cleanup() { [[ "$KEEP_TEMP" == yes ]] || rm -rf "$TMPROOT"; }
trap cleanup EXIT
WORK="$TMPROOT/repo"
echo "Preparing temporary rebase clone: $WORK"
git clone --no-local --no-tags "$PWD" "$WORK" >/dev/null
git -C "$WORK" remote set-url origin "$ORIGIN_URL"
git -C "$WORK" remote add upstream "$UPSTREAM_URL" 2>/dev/null || true
git -C "$WORK" fetch --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" >/dev/null
git -C "$WORK" fetch --no-tags upstream "+refs/heads/main:refs/remotes/upstream/main" >/dev/null
git -C "$WORK" config user.name "$GIT_NAME"
git -C "$WORK" config user.email "$GIT_EMAIL"
git -C "$WORK" switch --detach "refs/remotes/origin/$BRANCH" >/dev/null
git -C "$WORK" switch -c rebase-work >/dev/null

echo "Rebasing $BRANCH onto upstream/main"
if ! git -C "$WORK" rebase refs/remotes/upstream/main; then
  echo
  echo "REBASE STOPPED. Resolve these files in the temporary clone:"
  git -C "$WORK" status --short
  echo
  echo "Temporary clone: $WORK"
  echo "After resolving:"
  echo "  git -C '$WORK' add <resolved-files>"
  echo "  git -C '$WORK' rebase --continue"
  echo "  git -C '$WORK' push --force-with-lease=refs/heads/$BRANCH:$OLD_SHA origin HEAD:refs/heads/$BRANCH"
  exit 10
fi

NEW_SHA="$(git -C "$WORK" rev-parse HEAD)"
echo "Rebased tip: $NEW_SHA"
git -C "$WORK" push --force-with-lease="refs/heads/$BRANCH:$OLD_SHA" origin "HEAD:refs/heads/$BRANCH"
echo "Updated $REMOTE/$BRANCH with force-with-lease. Existing upstream PRs will use the updated branch."
