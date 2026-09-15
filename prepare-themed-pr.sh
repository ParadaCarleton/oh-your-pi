#!/usr/bin/env bash
# =============================================================================
# prepare-themed-pr.sh — build one focused PR branch from upstream/main
# =============================================================================
#
# Dry run:
#   bash ./prepare-themed-pr.sh --list
#   bash ./prepare-themed-pr.sh --topic tree-prune
#
# Build a local topic branch:
#   bash ./prepare-themed-pr.sh --topic tree-prune --execute
#
# After conflicts are resolved and tests pass, add --open-pr to push the branch
# and open a draft PR. The script never changes main.
# =============================================================================
set -euo pipefail

REMOTE="${REMOTE:-origin}"
UPSTREAM="${UPSTREAM:-upstream}"
TOPIC=""
MODE="plan"
OPEN_PR="no"
RESUME="no"

usage() {
  sed -n '3,18p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Options:
  --list              List available themes.
  --topic NAME        Select a theme.
  --execute           Create the local PR branch and cherry-pick its work.
  --resume            Continue after resolving a stopped cherry-pick.
  --open-pr           Push the completed branch and open a draft PR.
  --remote NAME       Fork remote (default: origin).
  --upstream NAME     Upstream remote (default: upstream).
  -h, --help          Show this help.

The script stops at conflicts. Resolve them, run the focused tests, and then
push/open the PR manually or rerun with --open-pr after the branch is complete.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) echo list; MODE="list" ;;
    --topic) [[ $# -ge 2 ]] || { echo "--topic needs a name" >&2; exit 2; }; TOPIC="$2"; shift ;;
    --execute) MODE="execute" ;;
    --resume) MODE="execute"; RESUME="yes" ;;
    --open-pr) OPEN_PR="yes" ;;
    --remote) [[ $# -ge 2 ]] || { echo "--remote needs a name" >&2; exit 2; }; REMOTE="$2"; shift ;;
    --upstream) [[ $# -ge 2 ]] || { echo "--upstream needs a name" >&2; exit 2; }; UPSTREAM="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

if [[ "$MODE" == list ]]; then
  cat <<'EOF'
Available themes:
  tree-prune          tree selector, collapse, archive foundation, connectors
  gc-prune            duplicate sessions, empty-session pruning, GC safety
  archive-navigation  archive-aware navigation and collaboration handling
  compact-cache       compact-edit, prompt-cache timing, cache expiry
  hub-wait            hub waits and async job delivery
  focused-subagent   focused subagent command routing
  native-ttsr         PowerAssertion, native queries, structured TTSR
  import-recovery     Claude/import recovery, API errors, stats/plugin fixes
  streaming-reveal    streaming reveal at tool-call boundaries
  docs-local-commits  autonomous local commit documentation
  jj-status            jj status working-copy snapshot
  python-background    Python eval auto-background default
  tui-scroll           whole-window tree scrolling
EOF
  exit 0
fi

[[ -n "$TOPIC" ]] || { usage; exit 2; }

die() { echo "ERROR: $*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || die "git is not installed"
git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a Git repository"
git remote get-url "$REMOTE" >/dev/null 2>&1 || die "no remote named '$REMOTE'"
git remote get-url "$UPSTREAM" >/dev/null 2>&1 || die "no remote named '$UPSTREAM'"

git config "remote.$REMOTE.fetch" "+refs/heads/*:refs/remotes/$REMOTE/*"
git fetch --prune --no-tags "$REMOTE" "+refs/heads/*:refs/remotes/$REMOTE/*" >/dev/null
git fetch --no-tags "$UPSTREAM" main >/dev/null
BASE="refs/remotes/$UPSTREAM/main"
UPSTREAM_TIP="$(git rev-parse FETCH_HEAD)"
FORK_TIP="$(git rev-parse "refs/remotes/$REMOTE/main")"
[[ "$UPSTREAM_TIP" == "$FORK_TIP" ]] || die "$REMOTE/main is not equal to $UPSTREAM/main; update main first"

AGGREGATE="refs/remotes/$REMOTE/fix/cache-expired-preprompt-shake"
AGGREGATE_COMMITS=()
SOURCES=()
TITLE=""
BRANCH=""

case "$TOPIC" in
  tree-prune)
    TITLE="Integrate tree collapse and pruning improvements"
    BRANCH="pr/integrated-tree-prune"
    AGGREGATE_COMMITS=(
      8b33af0fa55f26a1882de928c241d139d245780f
      38d4d0a27dfbbe4d516d3130bc81c76d405752fe
      1b4e7a715da30f45557f1aa4b63421b505039cc6
      c773111be40f2282d8499144ee5fbfb56dd6e376
      f51303cecc92412dac61f773056d4df97e967d12
      b87b19ba354089014da6a35fb9fc5959dd30f28c
      4694561757eb0fe3fa1b28b729a6d1648971c04c
      f502b1b3948f736499486fe4017e91ae15ba4f92
    )
    SOURCES=(fix/tree-selector-filtered-shape pr/tree-collapse fix/filtered-tree-connectors pr/export-collapse)
    ;;
  gc-prune)
    TITLE="Integrate session garbage collection and pruning"
    BRANCH="pr/integrated-gc-prune"
    AGGREGATE_COMMITS=(
      b4e4cb04d7b72d5e31947867e156b7bb70b5beae
      79c55bfa50b8e7b27c07c65fec1b7488d88a1816
      326559b981625caf2bc2ded908958522dfb9c878
      5b0b92eb7ed14045a6c9abc02dcaecc2ad14dc48
      cb7c01dbd7c1660bff7894065bb8bad59ecec0e2
      8979d0aacad33be50b6d4aeb49e35dbbd9bcce60
      a3765aba397ff3c4f3ecd03febacf206eba41d32
      17f5990cec96103d4c7a8e31e3cc4654e8dceeff
      9d1a2e9b193fb457f9f0c5750fccd6780b27d9a5
      4fccf64f79384e78074c59a490abaca74d392deb
      8b6c2d67b473435d808856856c8b32c5b82aa27a
      1663e0e9a7c4fc2eb783c9433b742d9e5093a41c
      2e0b3e1c60e6570c74d1ae4abe7bce5c7a5ff7ee
    )
    SOURCES=(pr/prune-empty-sessions review/pr8588-active-status review/pr8593-comments)
    ;;
  archive-navigation)
    TITLE="Integrate archive-aware session navigation"
    BRANCH="pr/integrated-archive-navigation"
    SOURCES=(pr/prune-archive review/pr8301-navigation)
    ;;
  compact-cache)
    TITLE="Integrate compact-edit and prompt-cache improvements"
    BRANCH="pr/integrated-compact-cache"
    AGGREGATE_COMMITS=(
      025b3cf7ecb91fd90fe837e676b549a99813e950
      29ee28e83e01736a49cded44c16c431a6c2db99a
      b7bdc051de7a1d5b268a63015a82bf01e034dfb6
      7384cd659d75206aa9696979a6ffdb5d8cca4697
      babb6345b0335fa14a1bc008041643d580fbd379
      17ee4141855ee97db794cfdbc9d07eba0f9a2509
      d3536383d36101df773a816f67a7de2eff5510ee
      af6ae2ad5c6a95006b5b445a3d188b64ce371e13
      485b1dcace58ec0ae41a330fdc02e09cd9735a91
      9f1e3b1b79fa3d6f3dc03b424e17ca2db3a0f13a
      11340e9eeb9786c56559f021bc4abf31faca90f7
      949c61880a43745c2c6ba77ee820c9d682e749c5
      434795f2850b1ea57b6c04ee2943086cf41223e5
      1ace8510d7bcea02d6b8eb0bec958ab812dfbc9c
      48ff58d1e1d5dd19849acd4fbc550f28a061ae5c
    )
    SOURCES=(fix/cache-expired-user-turn-shake)
    ;;
  hub-wait)
    TITLE="Integrate hub wait job delivery fixes"
    BRANCH="pr/integrated-hub-wait"
    AGGREGATE_COMMITS=(b00d49435ce042bf8e91f57555b78724f3697676 e6f0fbff72abaa8f463f46e627d5c7090a48ff50 88908030b366280eb6c491043030e2850917dabe 1c521fb9512dc0cf8c08e3da28209450ae612f3e)
    SOURCES=(fix/hub-wait-delivery)
    ;;
  focused-subagent)
    TITLE="Integrate focused-subagent command routing"
    BRANCH="pr/integrated-focused-subagent"
    AGGREGATE_COMMITS=(5ace4f3b25b63541b656d92ee3eda620b2f9488b e16239b3dd453dd645b00f400682c0e1bbf75b77 e5d138de7afaca0b3a6953ceb1df170763e118a7)
    ;;
  native-ttsr)
    TITLE="Integrate native and structured TTSR improvements"
    BRANCH="pr/integrated-native-ttsr"
    AGGREGATE_COMMITS=(f62b372d954134eaddfed12dbf17a3196adb4854 5b9aa90c2c44ef1124316c91c9b7d5691c57df02 64d67b8072c821a343a20ebd345b4b5e04d85f50 df10abe20e9ec885d07a7c50ea810d7ab4d5691e 57f1241f54652b142375bd3f706165f13f82df0d 17b1a7c0f6a084471234e47caa99a9693447fed8)
    SOURCES=(feat/ttsr-structured-ast-conditions fix/power-assertion-followups)
    ;;
  import-recovery)
    TITLE="Integrate import and Claude session recovery fixes"
    BRANCH="pr/integrated-import-recovery"
    AGGREGATE_COMMITS=(4ca5a50d2bcdf10e219300867199bb5dd1dc2b5b 1198a50d49ff9966bfef714dcf5749906cde69a8 4194068f555594b18ab9c20f299cda1a84da9281 ebeab9b590fb39a5e162307ef484ceefd6d5cd6b 1cc3eac23830e2719f0940112fb96eeee170b590 f0533ab13e83cc3fca1baaeb210b7defbe695e5f ae8acafecf29ba09d94ce472c9b2e932fbaf3f6f 43d2b1d266205ff0045bf9c2e8a909a6c4365e3c 4f7c327a05f51c06344a1db4d1d3700b63e64fd7)
    SOURCES=(fix/claude-import-tree import-decode-project-cwd import-api-error-failed-turn)
    ;;
  streaming-reveal)
    TITLE="Fix streaming reveal at tool-call boundaries"
    BRANCH="pr/integrated-streaming-reveal"
    SOURCES=(pr-10320)
    ;;
  docs-local-commits)
    TITLE="Document autonomous local commits"
    BRANCH="pr/integrated-local-commit-docs"
    SOURCES=(docs/allow-local-commits)
    ;;
  jj-status)
    TITLE="Snapshot the working copy for jj status"
    BRANCH="pr/integrated-jj-status"
    SOURCES=(fix/jj-status-snapshot)
    ;;
  python-background)
    TITLE="Enable Python eval auto-backgrounding by default"
    BRANCH="pr/integrated-python-background"
    SOURCES=(fix/python-eval-auto-background-default)
    ;;
  tui-scroll)
    TITLE="Scroll the session tree by one whole-window offset"
    BRANCH="pr/integrated-tui-scroll"
    SOURCES=(tui-tree-scroll-one-offset)
    ;;
  *) die "unknown topic '$TOPIC' (run --list)" ;;
esac

# Flatten the aggregate commits and source-branch commits into the exact order
# that will be cherry-picked. This makes conflict recovery resumable.
ALL_COMMITS=()
ALL_LABELS=()
for commit in "${AGGREGATE_COMMITS[@]}"; do
  ALL_COMMITS+=("$commit")
  ALL_LABELS+=("aggregate ${commit:0:12}")
done
for source in "${SOURCES[@]}"; do
  git show-ref --verify --quiet "refs/remotes/$REMOTE/$source" || die "missing source branch $source"
  mapfile -t source_commits < <(git log --reverse --no-merges --format='%H' "$BASE..refs/remotes/$REMOTE/$source")
  for commit in "${source_commits[@]}"; do
    ALL_COMMITS+=("$commit")
    ALL_LABELS+=("$source ${commit:0:12}")
  done
done

if [[ "$MODE" == plan ]]; then
  echo "Topic: $TOPIC"
  echo "Branch: $BRANCH"
  echo "Title: $TITLE"
  echo "Aggregate commits: ${#AGGREGATE_COMMITS[@]}"
  echo "Total cherry-picks: ${#ALL_COMMITS[@]}"
  printf 'Source branches:\n'; printf '  %s\n' "${SOURCES[@]:-none}"
  echo "Plan only: no changes were made. Add --execute to create the branch."
  exit 0
fi

STATE_FILE="$(git rev-parse --git-path "${BRANCH//\//-}.state")"
if [[ "$RESUME" == yes ]]; then
  [[ -f "$STATE_FILE" ]] || die "no saved state for $BRANCH; use --execute to start"
  [[ "$(git branch --show-current)" == "$BRANCH" ]] || die "switch to $BRANCH first"
  [[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ]] || die "a merge is in progress"
  [[ ! -e "$(git rev-parse --git-path CHERRY_PICK_HEAD)" ]] || die "finish the current cherry-pick before --resume"
  read -r start_index < "$STATE_FILE"
  [[ "$start_index" =~ ^[0-9]+$ ]] || die "invalid saved state"
  start_index=$((start_index + 1))
else
  [[ "$(git status --porcelain)" == "" ]] || die "working tree is not clean"
  [[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ]] || die "a merge is in progress"
  [[ ! -e "$(git rev-parse --git-path CHERRY_PICK_HEAD)" ]] || die "a cherry-pick is in progress"
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then die "local branch $BRANCH already exists; use --resume if appropriate"; fi
  if git ls-remote --exit-code --heads "$REMOTE" "refs/heads/$BRANCH" >/dev/null 2>&1; then die "remote branch $BRANCH already exists"; fi
  git switch -c "$BRANCH" "$BASE"
  start_index=0
fi

for ((i=start_index; i<${#ALL_COMMITS[@]}; i++)); do
  commit="${ALL_COMMITS[$i]}"
  label="${ALL_LABELS[$i]}"
  printf '%s\n' "$i" > "$STATE_FILE"
  echo "Cherry-picking [$((i + 1))/${#ALL_COMMITS[@]}] $label"

  if git cherry-pick "$commit"; then
    continue
  fi

  # A duplicate patch can become empty after an earlier themed commit. Drop it
  # automatically; stop only for a real content conflict.
  if [[ -z "$(git diff --name-only --diff-filter=U)" ]]; then
    git cherry-pick --skip
    continue
  fi

  echo
  echo "STOPPED on $label. Resolve the conflict, then run:"
  echo "  git add <resolved-files>"
  echo "  git cherry-pick --continue"
  echo "  bash ./prepare-themed-pr.sh --topic $TOPIC --resume"
  exit 10
done

rm -f "$STATE_FILE"
echo
echo "Built $BRANCH. Run focused tests before pushing."
if [[ "$OPEN_PR" == yes ]]; then
  command -v gh >/dev/null 2>&1 || die "gh is required for --open-pr"
  git push --set-upstream "$REMOTE" "$BRANCH"
  repo="$(git remote get-url "$REMOTE" | sed -E 's#(git@|https://)github.com[:/]##; s#\.git$##')"
  gh pr create --repo "$repo" --base main --head "$BRANCH" --draft --title "$TITLE" --body "Focused integration PR built from current main."
fi
