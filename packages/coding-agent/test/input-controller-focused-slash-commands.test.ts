/**
 * `/compact`, `/shake`, `/switch`, and `/tree` act on the session the user is
 * looking at, so they run while a subagent is focused. Every other builtin
 * reads `ctx.session` and is refused with a status line.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";

function createContext() {
	let editorText = "";
	const calls = {
		compact: vi.fn(async () => "ok"),
		shake: vi.fn(async () => {}),
		modelSelector: vi.fn(),
		treeSelector: vi.fn(),
		prompt: vi.fn(async () => {}),
		showStatus: vi.fn(),
	};

	const editor = {
		setText(text: string) {
			editorText = text;
		},
		getText() {
			return editorText;
		},
		setCollapsedText(text: string) {
			editorText = text;
		},
		composerChips: () => [],
		addToHistory: vi.fn(),
		imageLinks: undefined,
		pendingImages: [],
		pendingImageLinks: [],
		clearDraft() {
			editorText = "";
		},
	};

	const ctx = {
		editor,
		ui: { requestRender: vi.fn() },
		session: {
			isStreaming: false,
			isCompacting: false,
			extensionRunner: undefined,
			queuedMessageCount: 0,
			customCommands: [],
			promptTemplates: [],
		},
		skillCommands: new Map(),
		fileSlashCommands: new Map(),
		viewSession: { isStreaming: false, queuedMessageCount: 0, prompt: calls.prompt, abort: vi.fn(async () => {}) },
		focusedAgentId: "Worker",
		collabGuest: undefined,
		compactionQueuedMessages: [],
		locallySubmittedUserSignatures: new Set<string>(),
		handleCompactCommand: calls.compact,
		handleShakeCommand: calls.shake,
		showModelSelector: calls.modelSelector,
		showTreeSelector: calls.treeSelector,
		showStatus: calls.showStatus,
		showError: vi.fn(),
		showWarning: vi.fn(),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		recordSlashCommandUsage: vi.fn(),
		withLocalSubmission: async <T>(_text: string, fn: () => Promise<T>) => fn(),
	} as unknown as InteractiveModeContext;

	return { ctx, calls };
}

async function submit(text: string) {
	const { ctx, calls } = createContext();
	const controller = new InputController(ctx);
	controller.setupEditorSubmitHandler();
	await ctx.editor.onSubmit?.(text);
	return calls;
}

describe("focus-scoped slash commands", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("runs /compact against the focused session", async () => {
		const calls = await submit("/compact");
		expect(calls.compact).toHaveBeenCalledTimes(1);
		expect(calls.showStatus).not.toHaveBeenCalled();
		expect(calls.prompt).not.toHaveBeenCalled();
	});

	it("runs /shake against the focused session", async () => {
		const calls = await submit("/shake");
		expect(calls.shake).toHaveBeenCalledWith("elide");
		expect(calls.prompt).not.toHaveBeenCalled();
	});

	it("opens the model picker for /switch", async () => {
		const calls = await submit("/switch");
		expect(calls.modelSelector).toHaveBeenCalledWith({ temporaryOnly: true });
	});

	it("opens the tree selector for /tree", async () => {
		const calls = await submit("/tree");
		expect(calls.treeSelector).toHaveBeenCalledTimes(1);
	});

	it("refuses an unlisted command by name", async () => {
		const calls = await submit("/export");
		expect(calls.showStatus).toHaveBeenCalledWith("/export runs in the main session — press ←← to return first");
		expect(calls.prompt).not.toHaveBeenCalled();
	});

	it("keeps shell and Python input in the main session", async () => {
		const calls = await submit("!eza -l");
		expect(calls.showStatus).toHaveBeenCalledWith(
			"Shell and Python commands run in the main session — press ←← to return first",
		);
		expect(calls.prompt).not.toHaveBeenCalled();
	});

	it("still sends ordinary prose to the focused agent", async () => {
		const calls = await submit("please rerun the failing test");
		expect(calls.prompt).toHaveBeenCalledTimes(1);
		expect(calls.showStatus).not.toHaveBeenCalled();
	});
});
