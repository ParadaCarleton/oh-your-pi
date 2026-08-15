/**
 * Redirect the coding-agent dir at a throwaway directory, before anything reads
 * it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Session tests hand `SessionManager` a temp *cwd* but no temp *agent dir*, so
 * the storage root defaults to the developer's real `~/.omp/agent`, and
 * `computeDefaultSessionDir` creates the per-cwd directory eagerly — even a test
 * that never flushes leaves one behind. 42 had accumulated on one machine, 13
 * holding a fake one-line `"ok"` transcript the session picker displayed as a
 * real conversation.
 *
 * `scripts/ci-test-ts.ts` is the real containment: it runs each chunk in a mount
 * namespace where `~/.omp` is a tmpfs, so writes cannot escape however they are
 * addressed. This module is the fallback for a bare `bun test`, which has no
 * such namespace, and it is what the regression test can actually observe.
 *
 * WHAT IT CANNOT DO
 * -----------------
 * Not `HOME`: Bun resolves `os.homedir()` once at startup, so assigning
 * `process.env.HOME` here moves what env readers see and nothing else.
 * Redirecting `XDG_CONFIG_HOME` is actively harmful — the fish user-shell test
 * sets `HOME` for its own child and expects fish's config to follow, and fish
 * consults `XDG_CONFIG_HOME` first, so a sandboxed value made it load no
 * `config.fish` and exit 127. `PI_CODING_AGENT_DIR` is the one seam that works
 * in-process, because `packages/utils/src/dirs.ts` honors it directly.
 *
 * ORDERING
 * --------
 * `dirs.ts` builds its resolver in module scope, so this must be evaluated
 * before it. ESM runs imports in source order, so the preload importing this
 * module *first* applies the override in time; statements at the top of the
 * preload itself would run after the preload's own imports, i.e. too late.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The home this process must never write into. */
export const realHome = os.homedir();

/** Throwaway agent dir for this test process. */
export const sandboxAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-test-agent-"));

process.env.PI_CODING_AGENT_DIR = sandboxAgentDir;

process.on("exit", () => {
	try {
		fs.rmSync(sandboxAgentDir, { recursive: true, force: true });
	} catch {
		// Best-effort. A leftover directory under the OS temp root is harmless,
		// and a preload must never turn cleanup trouble into a failed run.
	}
});
