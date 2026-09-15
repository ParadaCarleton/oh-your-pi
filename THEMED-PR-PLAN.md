# Themed PR plan for `oh-your-pi`

## Base

The fork's `main` now matches the current `upstream/main` at
`c23ddf8f4f09fa518b9e5855235459e7c35705ca`.

Do **not** merge `fix/cache-expired-preprompt-shake` as one giant PR. It has 61
meaningful commits, but they cover several unrelated topics. Use it as source
material and split its contiguous commit blocks into themed PR branches.

The seven stale/redundant branches remain excluded.

## Proposed PRs

### 1. Tree collapse and selector behavior

Sources:

- Aggregate commits 1–8 below
- `feat/ttsr-structured-ast-conditions` only if its native/TTSR changes are
  intentionally coupled; otherwise use PR 7
- `fix/tree-selector-filtered-shape`
- `pr/tree-collapse`
- `fix/filtered-tree-connectors`
- `pr/export-collapse` can be a separate PR if HTML export review is easier

Aggregate source commits:

```text
8b33af0fa5 feat(export): collapse conversation branches in the HTML export
38d4d0a27d feat(tree): collapse conversation branches in the /tree selector
1b4e7a715d chore(ompf): keep the fork build script in the tree
c773111be4 feat(session): add /prune to drop empty conversation branches
f51303cecc feat(session): archive empty branches instead of deleting them
b87b19ba35 feat(tree): archive the highlighted branch from the /tree selector
4694561757 chore(changelog): move the fork's entries back under [Unreleased]
f502b1b394 test(session): pin that prune keeps replies truncated for length
```

### 2. Session GC and pruning

Sources:

- Aggregate commits 9–22 below
- `pr/prune-empty-sessions`
- `review/pr8588-active-status`
- `review/pr8593-comments`

These three dedicated branches overlap heavily. They should be combined into
one coherent implementation, not three separate merges.

### 3. Archive-aware navigation

Sources:

- `pr/prune-archive`
- `review/pr8301-navigation`

This is related to pruning but is large enough to deserve its own reviewable PR.

### 4. Compact-edit and cache behavior

Sources:

- Aggregate commits 27–39
- `fix/cache-expired-user-turn-shake`

### 5. Hub wait/job delivery

Sources:

- Aggregate commits 40–43
- `fix/hub-wait-delivery`

### 6. Focused-subagent commands

Sources:

- Aggregate commits 44–46

### 7. Native and TTSR support

Sources:

- Aggregate commits 47–52
- `feat/ttsr-structured-ast-conditions`
- `fix/power-assertion-followups`

### 8. Import, Claude recovery, stats, and plugin fixes

Sources:

- Aggregate commits 25–26 and 53–59
- `fix/claude-import-tree`
- `import-decode-project-cwd`
- `import-api-error-failed-turn`

### 9. Streaming reveal

Source:

- `pr-10320`

### 10. Small independent PRs

Keep these separate because they are already focused and do not benefit from
being merged together:

- `docs/allow-local-commits`
- `fix/jj-status-snapshot`
- `fix/python-eval-auto-background-default`
- `tui-tree-scroll-one-offset`

## Aggregate commit blocks

These are the remaining aggregate commits, in chronological order. The numbers
refer to the `git log --reverse` output for
`upstream/main..fix/cache-expired-preprompt-shake`.

```text
 9–22   GC, duplicate-session merging, pruning, and session maintenance
23      TUI tree scrolling
24      iterative archive pruning
25–26   imported API errors and plugin relinking
27–39   compact-edit, prompt-cache timing, and idle compaction
40–43   hub wait and async job delivery
44–46   focused-subagent commands
47–52   PowerAssertion, native queries, and TTSR
53–59   Claude import paths, stats folder, plugin/edit fixes
60–61   cache expiry before user turns
```

## Workflow

For each PR:

1. Create a branch from `origin/main`.
2. Cherry-pick only the relevant aggregate commits and dedicated-branch fixes.
3. Resolve conflicts within that topic.
4. Run the focused tests.
5. Push the topic branch and open a draft PR targeting `main`.

This produces understandable PRs instead of one 61-commit kitchen-sink merge.
