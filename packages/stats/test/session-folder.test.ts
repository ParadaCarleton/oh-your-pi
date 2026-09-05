import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { extractFolderFromPath, readSessionFolder } from "@oh-my-pi/omp-stats/parser";
import { getSessionsDir } from "@oh-my-pi/pi-utils";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@pi-stats-session-folder-");

/** Write a transcript under `dirName`, headed by the session record for `cwd`. */
async function writeTranscript(dirName: string, cwd: string | undefined): Promise<string> {
	const directory = path.join(getSessionsDir(), dirName);
	await fs.mkdir(directory, { recursive: true });
	const file = path.join(directory, "2026-01-01T00-00-00-000Z_session.jsonl");
	const header =
		cwd === undefined
			? { type: "title", v: 1, title: "Untitled" }
			: { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd };
	await Bun.write(file, `${JSON.stringify(header)}\n`);
	return file;
}

describe("readSessionFolder", () => {
	it("takes the folder from the cwd the transcript recorded", async () => {
		const cwd = "/home/user/Projects/linux-on-windows";
		const file = await writeTranscript("-Projects-linux-on-windows", cwd);

		expect(await readSessionFolder(file)).toBe(cwd);
	});

	it("keeps a hyphenated directory whole, where decoding the name splits it", async () => {
		const cwd = "/home/user/Projects/wiki-cont-count";
		const file = await writeTranscript("-Projects-wiki-cont-count", cwd);

		expect(await readSessionFolder(file)).toBe(cwd);
		expect(extractFolderFromPath(file)).not.toBe(cwd);
	});

	it("falls back to the directory name when no session header carries a cwd", async () => {
		const file = await writeTranscript("--work--pi--", undefined);

		expect(await readSessionFolder(file)).toBe(extractFolderFromPath(file));
	});
});
