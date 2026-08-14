import { describe, expect, it } from "bun:test";
import type { FileEntry, SessionHeader, SessionMessageEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { planSessionMerge } from "@oh-my-pi/pi-coding-agent/session/session-merge";
import { assistantMsg, toolCallMsg, toolResultMsg, userMsg } from "../utilities";

const BASE_TIME = Date.UTC(2026, 6, 16, 23, 59, 49, 486);
let tick = 0;
const nextStamp = () => new Date(BASE_TIME + tick++ * 1000).toISOString();

function msg(id: string, parentId: string | null, text = id): SessionMessageEntry {
	return { type: "message", id, parentId, timestamp: nextStamp(), message: userMsg(text) };
}

function reply(id: string, parentId: string | null, text = id): SessionMessageEntry {
	return { type: "message", id, parentId, timestamp: nextStamp(), message: assistantMsg(text) };
}

function call(id: string, parentId: string | null, text = id): SessionMessageEntry {
	return { type: "message", id, parentId, timestamp: nextStamp(), message: toolCallMsg(text) };
}

function result(id: string, parentId: string | null, text = id): SessionMessageEntry {
	return { type: "message", id, parentId, timestamp: nextStamp(), message: toolResultMsg(text) };
}

function header(id: string, cwd = "/tmp/project"): SessionHeader {
	return { type: "session", id, timestamp: nextStamp(), cwd };
}

const ids = (entries: readonly FileEntry[]) => entries.map(entry => entry.id);

/** Every entry parent must appear at a strictly earlier index. */
function assertTopological(entries: readonly FileEntry[]): void {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "session" && entry.parentId !== null) expect(seen.has(entry.parentId)).toBe(true);
		seen.add(entry.id);
	}
}

describe("planSessionMerge", () => {
	it("unions by id: shared entries stay once, source-only entries are grafted", () => {
		const shared = [msg("a", null), reply("b", "a")];
		const into = [...shared, msg("c", "b")];
		const from = [...shared, call("d", "b"), result("e", "d")];

		const plan = planSessionMerge(into, from);

		expect(ids(plan.merged)).toEqual(["a", "b", "c", "d", "e"]);
		expect(ids(plan.merged).filter(id => id === "b")).toHaveLength(1);
		expect(plan.keptEntries).toBe(3);
		expect(plan.addedEntries).toBe(2);
		expect(plan.skippedEntries).toBe(0);
		expect(plan.conflicts).toEqual([]);
		expect(plan.merged).toHaveLength(plan.keptEntries + plan.addedEntries);
	});

	it("keeps destination order for destination entries and appends grafts after them", () => {
		const into = [msg("a", null), reply("b", "a"), msg("c", "a")];
		const from = [reply("d", "a")];

		const plan = planSessionMerge(into, from);

		expect(ids(plan.merged)).toEqual(["a", "b", "c", "d"]);
		expect(plan.merged[0]).toBe(into[0]);
		expect(plan.merged[1]).toBe(into[1]);
		expect(plan.merged[2]).toBe(into[2]);
	});

	it("keeps the destination payload for a shared id and reports a payload conflict", () => {
		const into = [msg("a", null), reply("b", "a", "destination answer")];
		const from = [into[0], reply("b", "a", "source answer")];

		const plan = planSessionMerge(into, from);

		expect(plan.conflicts).toEqual([{ entryId: "b", reason: "payload" }]);
		expect(plan.merged[1]).toBe(into[1]);
		expect(plan.addedEntries).toBe(0);
		expect(plan.skippedEntries).toBe(0);
	});

	it("keeps the destination parent for a shared id and reports only a parent conflict", () => {
		const into = [msg("a", null), reply("b", "a"), msg("c", "b", "same payload")];
		const rebased: SessionMessageEntry = { ...into[2], parentId: "a" };
		const from = [into[0], into[1], rebased];

		const plan = planSessionMerge(into, from);

		expect(plan.conflicts).toEqual([{ entryId: "c", reason: "parent" }]);
		const mergedEntry = plan.merged[2];
		if (mergedEntry.type === "session") throw new Error("shared message became a session header");
		expect(mergedEntry.parentId).toBe("b");
		expect(mergedEntry).toBe(into[2]);
	});

	it("reports parent and payload conflicts separately when both axes disagree", () => {
		const into = [msg("a", null), reply("b", "a"), msg("c", "b", "destination text")];
		const divergent = { ...msg("c", "a", "source text"), timestamp: into[2].timestamp };
		const from = [into[0], into[1], divergent];

		const plan = planSessionMerge(into, from);

		expect(plan.conflicts).toEqual([
			{ entryId: "c", reason: "parent" },
			{ entryId: "c", reason: "payload" },
		]);
		expect(plan.merged[2]).toBe(into[2]);
	});

	it("grafts a source-only chain whole, parents before children, from non-topological input", () => {
		const into = [msg("a", null), reply("b", "a")];
		const grandchild = result("gc", "ch");
		const child = call("ch", "b");
		const from = [grandchild, child];

		const plan = planSessionMerge(into, from);

		expect(plan.addedEntries).toBe(2);
		expect(plan.skippedEntries).toBe(0);
		expect(ids(plan.merged)).toEqual(["a", "b", "ch", "gc"]);
		assertTopological(plan.merged);
	});

	it("skips a source-only entry whose parent is absent everywhere, plus its descendants", () => {
		const into = [msg("a", null), reply("b", "a")];
		const orphan = msg("o", "ghost");
		const orphanChild = reply("o-child", "o");
		const attached = call("g", "b");
		const from = [orphan, orphanChild, attached];

		const plan = planSessionMerge(into, from);

		expect(plan.addedEntries).toBe(1);
		expect(plan.skippedEntries).toBe(2);
		expect(ids(plan.merged)).toEqual(["a", "b", "g"]);
		expect(ids(plan.merged)).not.toContain("o");
		expect(ids(plan.merged)).not.toContain("o-child");
	});

	it("never grafts a second session header, nor anything hanging off it", () => {
		const into = [header("hdr"), msg("a", null), reply("b", "a")];
		const from = [header("hdr-2"), msg("under-header", "hdr-2"), call("g", "b")];

		const plan = planSessionMerge(into, from);

		expect(ids(plan.merged)).toEqual(["hdr", "a", "b", "g"]);
		expect(plan.addedEntries).toBe(1);
		expect(plan.skippedEntries).toBe(2);
		expect(plan.conflicts).toEqual([]);
	});
	it("accepts loader-shaped files and keeps exactly the destination header", () => {
		const destinationHeader = header("session-id", "/projects/destination");
		const sourceHeader = { ...destinationHeader, cwd: "/projects/source" };
		const root = msg("a", null);
		const into: FileEntry[] = [destinationHeader, root, reply("b", "a")];
		const from: FileEntry[] = [sourceHeader, root, call("c", "a")];

		const plan = planSessionMerge(into, from);

		expect(plan.merged[0]).toBe(destinationHeader);
		expect(plan.merged.filter(entry => entry.type === "session")).toEqual([destinationHeader]);
		expect(ids(plan.merged)).toEqual(["session-id", "a", "b", "c"]);
		expect(plan.keptEntries).toBe(3);
		expect(plan.addedEntries).toBe(1);
		expect(plan.skippedEntries).toBe(0);
	});
	it("reports a changed title on a shared header and keeps the destination header verbatim", () => {
		const destinationHeader = { ...header("session-id"), title: "Destination", titleSource: "user" as const };
		const sourceHeader = { ...destinationHeader, title: "Source", titleSource: "auto" as const };

		const plan = planSessionMerge([destinationHeader], [sourceHeader]);

		expect(plan.conflicts).toEqual([{ entryId: "session-id", reason: "header" }]);
		expect(plan.merged).toEqual([destinationHeader]);
		expect(plan.merged[0]).toBe(destinationHeader);
		expect(plan.skippedEntries).toBe(0);
	});

	it("does not report a conflict for byte-identical shared headers", () => {
		const destinationHeader = { ...header("session-id"), title: "Same", titleSource: "user" as const };
		const sourceHeader = { ...destinationHeader };

		const plan = planSessionMerge([destinationHeader], [sourceHeader]);

		expect(plan.conflicts).toEqual([]);
		expect(plan.merged).toEqual([destinationHeader]);
		expect(plan.skippedEntries).toBe(0);
	});

	it("is idempotent: re-planning against the merged output adds nothing", () => {
		const into = [msg("a", null), reply("b", "a"), msg("c", "b", "destination text")];
		const from = [
			result("gc", "ch"),
			call("ch", "b"),
			{ ...msg("c", "b", "source text"), timestamp: into[2].timestamp },
			msg("o", "ghost"),
		];

		const first = planSessionMerge(into, from);
		expect(first.addedEntries).toBe(2);

		const second = planSessionMerge(first.merged, from);

		expect(second.addedEntries).toBe(0);
		expect(second.keptEntries).toBe(first.merged.length);
		expect(second.skippedEntries).toBe(first.skippedEntries);
		expect(second.conflicts).toEqual(first.conflicts);
		expect(ids(second.merged)).toEqual(ids(first.merged));
	});

	it("produces a topologically valid merged array from a shuffled source", () => {
		const into = [msg("a", null), reply("b", "a"), msg("c", "a")];
		const from = [
			result("s4", "s3"),
			call("s3", "s2"),
			reply("s2", "s1"),
			msg("s1", "c"),
			reply("t2", "t1"),
			msg("t1", "b"),
		];

		const plan = planSessionMerge(into, from);

		expect(plan.addedEntries).toBe(6);
		expect(plan.skippedEntries).toBe(0);
		assertTopological(plan.merged);
	});

	it("grafts an entire tree, root included, into an empty destination", () => {
		const from = [reply("b", "a"), msg("a", null), call("c", "b")];

		const plan = planSessionMerge([], from);

		expect(plan.keptEntries).toBe(0);
		expect(plan.addedEntries).toBe(3);
		expect(plan.skippedEntries).toBe(0);
		expect(ids(plan.merged)).toEqual(["a", "b", "c"]);
		assertTopological(plan.merged);
	});

	it("leaves the inputs untouched", () => {
		const into = [msg("a", null), reply("b", "a")];
		const from = [call("c", "b"), msg("o", "ghost")];

		planSessionMerge(into, from);

		expect(into).toHaveLength(2);
		expect(from).toHaveLength(2);
		expect(ids(into)).toEqual(["a", "b"]);
	});
});
