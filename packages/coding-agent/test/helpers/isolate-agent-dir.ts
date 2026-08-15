/**
 * Bun test preload: point the agent dir at a throwaway directory, then rebuild
 * the resolver that already captured the old one, and trip loudly if anything
 * still reaches the developer's real agent dir.
 *
 * The environment override lives in `./sandbox-agent-dir` and must be imported
 * first — see the ordering note there. This file's job is the part that has to
 * happen *after* `@oh-my-pi/pi-utils` is loaded.
 *
 * Guarded by `test/session-manager/agent-dir-isolation.test.ts`.
 */

import { afterAll } from "bun:test";

import * as fs from "node:fs";
import * as path from "node:path";
import { __resetDirsFromEnvForTests } from "@oh-my-pi/pi-utils";
import { realHome } from "./sandbox-agent-dir";

// `dirs.ts` builds its resolver at import time, so by now it has already frozen
// one from the environment as it was before `sandbox-agent-dir` ran. Rebuild it,
// and its pre-profile `PI_CODING_AGENT_DIR` snapshot, from the sandboxed value —
// so a suite that later calls `setProfile(undefined)` restores the sandbox
// rather than the developer's real dir.
__resetDirsFromEnvForTests();

/**
 * Tripwire. The override above is the in-process fix and the namespace in
 * `scripts/ci-test-ts.ts` is the real containment; this exists so that a future
 * leak — a test that hardcodes a real path, or code that resolves one before
 * this preload runs — fails a test run instead of silently accruing junk in
 * someone's home directory for months.
 *
 * Scoped to session directories whose name marks them as coming from a temp cwd
 * (`-tmp…`), because the developer's own agent may legitimately be running
 * during a test run and creating real session dirs; those are named after real
 * project paths and must not fail the suite.
 */
const realSessionsDir = path.join(realHome, ".omp", "agent", "sessions");

function tempSessionDirs(): Set<string> {
	try {
		return new Set(fs.readdirSync(realSessionsDir).filter(entry => entry.startsWith("-tmp")));
	} catch {
		return new Set();
	}
}

const leakedBefore = tempSessionDirs();

/**
 * Inside the runner's mount namespace `~/.omp` is a tmpfs, so its contents are
 * a throwaway copy: comparing them would flag writes that were already
 * contained. The namespace is the stronger guarantee, so defer to it.
 */
const osContained = process.env.PI_TEST_SANDBOXED === "1";

afterAll(() => {
	if (osContained) return;
	const leaked = [...tempSessionDirs()].filter(entry => !leakedBefore.has(entry));
	if (leaked.length === 0) return;
	throw new Error(
		`Tests wrote into the real agent directory ${realSessionsDir}: ${leaked.join(", ")}. ` +
			`Something resolved a home-derived path before this preload, or hardcoded one. ` +
			`Pass an explicit temp agent dir, or fix the resolution order.`,
	);
});
