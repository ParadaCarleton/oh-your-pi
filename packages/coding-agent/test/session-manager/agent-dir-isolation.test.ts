import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { __resetDirsFromEnvForTests, isEnoent, TempDir } from "@oh-my-pi/pi-utils";
import { realHome, sandboxAgentDir } from "../helpers/sandbox-agent-dir";
import { makeAssistantMessage } from "./helpers";

function directoryEntries(dir: string): Set<string> {
	try {
		return new Set(fs.readdirSync(dir));
	} catch (error) {
		if (isEnoent(error)) return new Set();
		throw error;
	}
}

test("default sessions never write into the user's real agent directory", async () => {
	// Sibling tests in this process legitimately repoint the agent dir (profiles,
	// explicit overrides) and some restore it to the real one, so the ambient
	// resolver state says nothing about what a clean run does. Re-establish the
	// preload's environment and rebuild from it: the contract under test is
	// "with PI_CODING_AGENT_DIR set, the default lands there, not in the home".
	process.env.PI_CODING_AGENT_DIR = sandboxAgentDir;
	__resetDirsFromEnvForTests();

	const realSessionsDir = path.join(realHome, ".omp", "agent", "sessions");
	const entriesBefore = directoryEntries(realSessionsDir);

	using cwd = TempDir.createSync("@pi-session-agent-dir-isolation-");
	const session = SessionManager.create(cwd.path());
	session.appendMessage(makeAssistantMessage());
	await session.flush();

	// Under `scripts/ci-test-ts.ts` this path is a tmpfs inside a mount
	// namespace, so its contents are a throwaway copy and any sibling test's
	// contained write would show up here as a false leak. The namespace is the
	// stronger guarantee; the check below still proves the redirect works.
	if (process.env.PI_TEST_SANDBOXED !== "1") {
		expect(directoryEntries(realSessionsDir)).toEqual(entriesBefore);
	}

	// The session must really have been written somewhere, or the check above
	// passes vacuously. Where exactly is not asserted: sibling tests in the same
	// process legitimately relocate the agent dir (profiles, explicit
	// overrides), so pinning the path here would make this test order-dependent.
	// "Outside the real home" is the invariant that protects the developer.
	const sessionFile = session.getSessionFile();
	if (!sessionFile) throw new Error("Expected the flushed session to have a file");
	expect(fs.existsSync(sessionFile)).toBe(true);
	const fromRealHome = path.relative(realHome, sessionFile);
	expect(fromRealHome.startsWith(`..${path.sep}`) || path.isAbsolute(fromRealHome)).toBe(true);
});
