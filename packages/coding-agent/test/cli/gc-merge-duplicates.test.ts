import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runGcCommand } from "@oh-my-pi/pi-coding-agent/cli/gc-cli";
import type { FileEntry, SessionEntry, SessionHeader } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { loadEntriesFromFile } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { computeDefaultSessionDir } from "@oh-my-pi/pi-coding-agent/session/session-paths";
import { FileSessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";
import { getSessionsDir } from "@oh-my-pi/pi-utils";

const SESSION_ID = "019f6d5f-4aee-7000-a3ab-3b62adc9b302";
const TIMESTAMP = "2026-07-16T23-59-49-486Z";
const OLD_DATE = new Date("2026-01-01T00:00:00.000Z");

let root: string;
let stdoutSpy: { mockRestore(): void } | undefined;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gc-merge-"));
	stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(async () => {
	stdoutSpy?.mockRestore();
	stdoutSpy = undefined;
	await fs.rm(root, { recursive: true, force: true });
});

function header(id: string, cwd: string): SessionHeader {
	return { type: "session", version: 3, id, timestamp: "2026-07-16T23:59:49.486Z", cwd };
}

function entry(id: string, parentId: string | null, branch: string): SessionEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp: "2026-07-17T00:00:00.000Z",
		customType: "merge-test",
		data: { branch },
	};
}

async function writeSession(
	directory: string,
	filename: string,
	fileHeader: SessionHeader,
	entries: SessionEntry[],
): Promise<string> {
	await fs.mkdir(directory, { recursive: true });
	const file = path.join(directory, filename);
	await Bun.write(file, `${[fileHeader, ...entries].map(value => JSON.stringify(value)).join("\n")}\n`);
	await fs.utimes(file, OLD_DATE, OLD_DATE);
	return file;
}

function logicalEntries(entries: FileEntry[]): SessionEntry[] {
	return entries.filter((value): value is SessionEntry => "parentId" in value);
}

async function createDivergentPair(agentDir: string): Promise<{
	destination: string;
	source: string;
	sourceArtifact: string;
	destinationBefore: FileEntry[];
}> {
	const sessionsRoot = getSessionsDir(agentDir);
	const cwd = path.join(os.homedir(), "Projects", `gc-merge-${path.basename(root)}`);
	const destinationDir = computeDefaultSessionDir(cwd, new FileSessionStorage(), sessionsRoot);
	const sourceDir = path.join(sessionsRoot, "-moved-project");
	const filename = `${TIMESTAMP}_${SESSION_ID}.jsonl`;
	const shared = entry("shared", null, "shared");
	const destination = await writeSession(destinationDir, filename, header(SESSION_ID, cwd), [
		shared,
		entry("destination-branch", "shared", "destination"),
	]);
	const source = await writeSession(sourceDir, filename, header(SESSION_ID, cwd), [
		shared,
		entry("source-branch", "shared", "source"),
	]);
	const sourceArtifacts = source.slice(0, -".jsonl".length);
	const sourceArtifact = path.join(sourceArtifacts, "attachments", "branch.txt");
	await fs.mkdir(path.dirname(sourceArtifact), { recursive: true });
	await Bun.write(sourceArtifact, "source branch artifact");
	return {
		destination,
		source,
		sourceArtifact,
		destinationBefore: await loadEntriesFromFile(destination, new FileSessionStorage()),
	};
}

async function backupFiles(destination: string): Promise<string[]> {
	const directory = path.dirname(destination);
	const basename = path.basename(destination);
	const glob = new Bun.Glob(`${basename}.*.bak`);
	return Array.fromAsync(glob.scan(directory), name => path.join(directory, name));
}

describe("omp gc duplicate-session merge", () => {
	test("dry-run reports divergent duplicates without changing either file", async () => {
		const agentDir = path.join(root, "agent");
		const pair = await createDivergentPair(agentDir);
		const destinationBefore = await Bun.file(pair.destination).text();
		const sourceBefore = await Bun.file(pair.source).text();

		const result = await runGcCommand({ flags: { agentDir, mergeDuplicates: true } });

		expect(result.mergeDuplicates?.groups).toBe(1);
		expect(result.mergeDuplicates?.wouldMerge).toBe(1);
		expect(result.mergeDuplicates?.candidates).toEqual([
			{ sessionId: SESSION_ID, destination: pair.destination, sources: [pair.source] },
		]);
		expect(result.mergeDuplicates?.addedEntries).toBe(1);
		expect(await Bun.file(pair.destination).text()).toBe(destinationBefore);
		expect(await Bun.file(pair.source).text()).toBe(sourceBefore);
		expect(await Bun.file(pair.sourceArtifact).text()).toBe("source branch artifact");
		expect(await backupFiles(pair.destination)).toEqual([]);
	});

	test("apply writes the union, keeps a parseable backup, and archives the consumed source", async () => {
		const agentDir = path.join(root, "agent");
		const pair = await createDivergentPair(agentDir);

		const result = await runGcCommand({ flags: { agentDir, mergeDuplicates: true, apply: true } });

		expect(result.mergeDuplicates?.merged).toBe(1);
		expect(result.mergeDuplicates?.archivedSources).toBe(1);
		const merged = logicalEntries(await loadEntriesFromFile(pair.destination, new FileSessionStorage()));
		expect(merged.map(value => value.id)).toEqual(["shared", "destination-branch", "source-branch"]);
		const backups = await backupFiles(pair.destination);
		expect(backups).toHaveLength(1);
		expect(await loadEntriesFromFile(backups[0]!, new FileSessionStorage())).toEqual(pair.destinationBefore);
		expect(await Bun.file(pair.source).exists()).toBe(false);
		const sessionsRoot = getSessionsDir(agentDir);
		const archivedSource = path.join(
			path.dirname(sessionsRoot),
			"archive",
			"sessions",
			path.relative(sessionsRoot, pair.source),
		);
		expect(await Bun.file(archivedSource).exists()).toBe(true);
		expect(await loadEntriesFromFile(archivedSource, new FileSessionStorage())).toHaveLength(3);
		const archivedArtifact = path.join(
			path.dirname(archivedSource),
			path.basename(archivedSource, ".jsonl"),
			"attachments",
			"branch.txt",
		);
		expect(await Bun.file(archivedArtifact).text()).toBe("source branch artifact");
		expect(await Bun.file(pair.sourceArtifact).exists()).toBe(false);
	});

	test("leaves same-directory collisions and different session ids alone", async () => {
		const agentDir = path.join(root, "agent");
		const sessionsRoot = getSessionsDir(agentDir);
		const sameDir = path.join(sessionsRoot, "-same");
		const sameId = "019f6d5f-4aee-7000-a3ab-3b62adc9b301";
		const sameA = await writeSession(sameDir, `a_${sameId}.jsonl`, header(sameId, "/same"), [
			entry("same-a", null, "a"),
		]);
		const sameB = await writeSession(sameDir, `b_${sameId}.jsonl`, header(sameId, "/same"), [
			entry("same-b", null, "b"),
		]);
		const differentAId = "019f6d5f-4aee-7000-a3ab-3b62adc9b302";
		const differentBId = "019f6d5f-4aee-7000-a3ab-3b62adc9b303";
		const differentA = await writeSession(
			path.join(sessionsRoot, "-different-a"),
			`a_${differentAId}.jsonl`,
			header(differentAId, "/different-a"),
			[entry("different-a", null, "a")],
		);
		const differentB = await writeSession(
			path.join(sessionsRoot, "-different-b"),
			`b_${differentBId}.jsonl`,
			header(differentBId, "/different-b"),
			[entry("different-b", null, "b")],
		);
		const files = [sameA, sameB, differentA, differentB];
		const before = await Promise.all(files.map(file => Bun.file(file).text()));

		const result = await runGcCommand({ flags: { agentDir, mergeDuplicates: true, apply: true } });

		expect(result.mergeDuplicates?.groups).toBe(0);
		expect(await Promise.all(files.map(file => Bun.file(file).text()))).toEqual(before);
	});
});
