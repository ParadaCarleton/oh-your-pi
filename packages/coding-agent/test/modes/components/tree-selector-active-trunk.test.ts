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

function renderStripped(tree: SessionTreeNode[], leafId: string): string[] {
	const selector = new TreeSelectorComponent(
		tree,
		leafId,
		200,
		() => {},
		() => {},
	);
	return selector.renderContent(160).map(line => Bun.stripANSI(line));
}

describe("the active branch is the trunk", () => {
	beforeAll(async () => {
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");
	});

	// Every interrupted turn leaves an abandoned stub beside the continuation.
	// Indenting the continuation too would stack one gutter per interruption and
	// push real conversations off the right edge.
	it("keeps interrupted turns from stacking gutters", () => {
		const root = makeNode("user", "root question");
		let cursor: SessionTreeNode = root;
		for (let turn = 0; turn < 20; turn++) {
			const reply = chain(cursor, "assistant", `reply ${turn}`);
			chain(reply, "assistant", `abandoned ${turn}`);
			cursor = chain(reply, "user", `follow-up ${turn}`);
		}

		const rendered = renderStripped([root], cursor.entry.id);

		for (const row of rendered) {
			expect(row).not.toContain("│");
		}
		expect(rendered.find(line => line.includes("follow-up 19"))).toMatch(/^› (?:• )?user: follow-up 19/);

		// Divergences still show, one level in from the trunk they left.
		expect(rendered.find(line => line.includes("abandoned 19"))).toMatch(/^ {2}└─ \S/);
	});

	// A fork off the active path has no trunk to keep, so both sides indent and
	// the standard connector semantics apply.
	it("indents both sides of a fork that the active path never enters", () => {
		const root = makeNode("user", "root question");
		const active = chain(chain(root, "assistant", "active reply"), "user", "active leaf");
		const dormant = chain(root, "assistant", "dormant reply");
		chain(dormant, "user", "left thread");
		chain(dormant, "user", "right thread");

		const rendered = renderStripped([root], active.entry.id);
		const findRow = (needle: string): string => {
			const row = rendered.find(line => line.includes(needle));
			if (!row) throw new Error(`row containing ${JSON.stringify(needle)} not rendered`);
			return row;
		};

		expect(findRow("user: left thread")).toMatch(/^ {5}├─ \S/);
		expect(findRow("user: right thread")).toMatch(/^ {5}└─ \S/);
	});
});
