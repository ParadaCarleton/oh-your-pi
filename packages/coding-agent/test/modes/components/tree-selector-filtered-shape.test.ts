import { beforeAll, describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { TreeSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tree-selector";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SessionEntry, SessionTreeNode } from "@oh-my-pi/pi-coding-agent/session/session-entries";

let counter = 0;
function makeNode(role: "user" | "assistant", text: string, parentId: string | null = null): SessionTreeNode {
	const id = `e${counter++}`;
	const message: AgentMessage =
		role === "user"
			? { role: "user", content: text, timestamp: counter }
			: ({
					role: "assistant",
					content: [{ type: "text", text }],
					timestamp: counter,
					stopReason: "stop",
				} as AgentMessage);
	const entry: SessionEntry = {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message,
	};
	return { entry, children: [] };
}

function chain(parent: SessionTreeNode, role: "user" | "assistant", text: string): SessionTreeNode {
	const node = makeNode(role, text, parent.entry.id);
	parent.children.push(node);
	return node;
}

/** Rendered rows with the dialog frame removed, so assertions see only tree columns. */
function renderStripped(tree: SessionTreeNode[], leafId: string, mode: "default" | "user-only"): string[] {
	const selector = new TreeSelectorComponent(
		tree,
		leafId,
		60,
		() => {},
		() => {},
		undefined,
		mode,
	);
	return selector
		.render(120)
		.map(line => /^│ (.*)│$/.exec(Bun.stripANSI(line))?.[1]?.trimEnd())
		.filter((line): line is string => line !== undefined);
}

function findRow(rendered: string[], needle: string): string {
	const row = rendered.find(line => line.includes(needle));
	if (!row) throw new Error(`row containing ${JSON.stringify(needle)} not rendered`);
	return row;
}

/** Column of the row's `├─`/`└─`, which is its depth in the drawn tree. */
function connectorColumn(row: string): number {
	const column = row.search(/[├└]─/);
	if (column < 0) throw new Error(`row has no connector: ${JSON.stringify(row)}`);
	return column;
}

describe("filtered rows carry the shape of the filtered tree", () => {
	beforeAll(async () => {
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");
	});

	// A fork whose other side the filter hides is not a fork in the view, so the
	// surviving child owns neither a connector nor an indentation level.
	it("does not indent for a fork whose other side the filter removed", () => {
		const root = makeNode("user", "root question");
		let cursor: SessionTreeNode = root;
		for (const nth of ["first", "second", "third"]) {
			const reply = chain(cursor, "assistant", `${nth} reply`);
			chain(reply, "assistant", `${nth} abandoned stub`);
			cursor = chain(reply, "user", `${nth} follow-up`);
		}

		const unfiltered = renderStripped([root], cursor.entry.id, "default");
		expect(findRow(unfiltered, "third abandoned stub")).toMatch(/[├└]─/);

		const filtered = renderStripped([root], cursor.entry.id, "user-only");
		expect(filtered.some(line => line.includes("abandoned stub"))).toBe(false);

		// Three forks removed leaves one linear chain: cursor, active-path dot, text.
		for (const needle of ["root question", "first follow-up", "second follow-up", "third follow-up"]) {
			expect(findRow(filtered, needle)).toMatch(/^(?:› | {2})(?:• )?user: /);
		}
	});

	// A surviving branch sits at the depth its visible ancestors give it, not the
	// depth of branch points that never render.
	it("places a surviving branch under its nearest visible ancestor", () => {
		const root = makeNode("user", "root question");
		const active = chain(chain(root, "assistant", "active reply"), "user", "active leaf");
		chain(root, "user", "alternate branch");
		const deeper = chain(chain(root, "assistant", "reply"), "assistant", "deeper reply");
		chain(deeper, "assistant", "abandoned stub");
		chain(deeper, "user", "main line");

		const unfiltered = renderStripped([root], active.entry.id, "default");
		expect(connectorColumn(findRow(unfiltered, "main line"))).toBeGreaterThan(
			connectorColumn(findRow(unfiltered, "alternate branch")),
		);

		// The filter leaves them the only diverging nodes below the root, so they
		// become siblings of each other.
		const filtered = renderStripped([root], active.entry.id, "user-only");
		expect(connectorColumn(findRow(filtered, "main line"))).toBe(
			connectorColumn(findRow(filtered, "alternate branch")),
		);
		expect(findRow(filtered, "root question")).not.toContain("│");
	});
});
