import type { FileEntry, SessionEntry, SessionHeader } from "./session-entries";

/** A disagreement on one independently compared part of a shared entry. */
export interface SessionMergeConflict {
	entryId: string;
	reason: "parent" | "payload" | "header";
}

export interface SessionMergePlan {
	/** Entries already present in the authoritative destination. */
	keptEntries: number;
	/** Source-only entries grafted into the destination tree. */
	addedEntries: number;
	/** Source-only entries that cannot attach, including their descendants. */
	skippedEntries: number;
	conflicts: SessionMergeConflict[];
	/** Destination order followed by source-only entries in topological order. */
	merged: FileEntry[];
}

/**
 * Plan a union of two files for the same logical session.
 *
 * In practice, two concurrent writers can carry the same session id into two
 * project directories. Their files share much of the tree but each can contain
 * branches the other lacks, so exact-file deduplication would lose work. This
 * merge instead unions entries by id and grafts every source-only branch whose
 * ancestry reaches an existing entry (or a null root).
 *
 * The destination wins for shared ids because applying a merge must not rewrite
 * data already chosen by the operator as the target. Parent and payload are
 * compared independently: a parent-only disagreement reports only `parent`;
 * differences in all fields other than `parentId` report `payload`, so an entry
 * that differs on both axes reports both conflicts. Headers are compared as a
 * whole because concurrent writers can diverge on `title` and `titleSource`;
 * a changed shared header reports `header`, but the destination copy is kept.
 * Source headers are partitioned first and never grafted.
 */
export function planSessionMerge(into: readonly FileEntry[], from: readonly FileEntry[]): SessionMergePlan {
	const destinationIds = new Set(into.map(entry => entry.id));
	const destinationById = new Map<string, SessionEntry>();
	const destinationHeaderById = new Map<string, SessionHeader>();
	for (const entry of into) {
		if (entry.type === "session") destinationHeaderById.set(entry.id, entry);
		else destinationById.set(entry.id, entry);
	}

	const conflicts: SessionMergeConflict[] = [];
	const sourceById = new Map<string, SessionEntry>();
	const seenSourceIds = new Set<string>();
	let skippedHeaders = 0;
	for (const entry of from) {
		if (seenSourceIds.has(entry.id)) continue;
		seenSourceIds.add(entry.id);
		if (entry.type === "session") {
			const destinationHeader = destinationHeaderById.get(entry.id);
			if (destinationHeader) {
				if (!Bun.deepEquals(destinationHeader, entry)) {
					conflicts.push({ entryId: entry.id, reason: "header" });
				}
			} else {
				skippedHeaders++;
			}
			continue;
		}
		sourceById.set(entry.id, entry);
	}

	for (const source of sourceById.values()) {
		const destination = destinationById.get(source.id);
		if (!destination) continue;

		const parentDiffers = destination.parentId !== source.parentId;
		if (parentDiffers) conflicts.push({ entryId: source.id, reason: "parent" });

		const payloadDiffers = parentDiffers
			? !Bun.deepEquals(destination, { ...source, parentId: destination.parentId })
			: !Bun.deepEquals(destination, source);
		if (payloadDiffers) conflicts.push({ entryId: source.id, reason: "payload" });
	}

	const sourceOnly = new Map<string, SessionEntry>();
	const childrenByParent = new Map<string, SessionEntry[]>();
	const ready: SessionEntry[] = [];
	for (const source of sourceById.values()) {
		if (destinationIds.has(source.id)) continue;
		sourceOnly.set(source.id, source);

		if (source.parentId === null || destinationIds.has(source.parentId)) {
			ready.push(source);
			continue;
		}
		const siblings = childrenByParent.get(source.parentId);
		if (siblings) siblings.push(source);
		else childrenByParent.set(source.parentId, [source]);
	}

	const grafted: SessionEntry[] = [];
	const graftedIds = new Set<string>();
	for (let index = 0; index < ready.length; index++) {
		const entry = ready[index];
		if (graftedIds.has(entry.id)) continue;
		graftedIds.add(entry.id);
		grafted.push(entry);

		const children = childrenByParent.get(entry.id);
		if (children) ready.push(...children);
	}

	return {
		keptEntries: into.length,
		addedEntries: grafted.length,
		skippedEntries: skippedHeaders + sourceOnly.size - grafted.length,
		conflicts,
		merged: [...into, ...grafted],
	};
}
