/**
 * `!bash` and `$python` typed while a subagent session is focused run against
 * that session, not the main one. Only slash commands stay main-session-only.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";

function createContext(focusedAgentId: string | undefined) {
	let editorText = "";
	const handleBashCommand = vi.fn(async () => {});
	const handlePythonCommand = vi.fn(async () => {});
	const showStatus = vi.fn();
	const prompt = vi.fn(async () => {});

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

	const session = { isStreaming: false, isCompacting: false, extensionRunner: undefined, queuedMessageCount: 0 };
	const viewSession = {
		isStreaming: false,
		queuedMessageCount: 0,
		isBashRunning: false,
		isEvalRunning: false,
		prompt,
		abort: vi.fn(async () => {}),
	};

	const ctx = {
		editor,
		ui: { requestRender: vi.fn() },
		session,
		viewSession: focusedAgentId ? viewSession : session,
		focusedAgentId,
		compactionQueuedMessages: [],
		locallySubmittedUserSignatures: new Set<string>(),
		handleBashCommand,
		handlePythonCommand,
		showStatus,
		showError: vi.fn(),
		showWarning: vi.fn(),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		isBashMode: false,
		isPythonMode: false,
		withLocalSubmission: async <T>(_text: string, fn: () => Promise<T>) => fn(),
	} as unknown as InteractiveModeContext;

	return { ctx, editor, handleBashCommand, handlePythonCommand, showStatus, prompt };
}

describe("InputController inline execution while focused on a subagent", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("runs a bash command instead of rejecting it", async () => {
		const { ctx, handleBashCommand, showStatus, prompt } = createContext("Worker");
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await ctx.editor.onSubmit?.("!eza -l");

		expect(handleBashCommand).toHaveBeenCalledWith("eza -l", false);
		expect(showStatus).not.toHaveBeenCalled();
		// Not forwarded to the agent as prose.
		expect(prompt).not.toHaveBeenCalled();
	});

	it("runs a python command instead of rejecting it", async () => {
		const { ctx, handlePythonCommand, showStatus } = createContext("Worker");
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await ctx.editor.onSubmit?.("$ 2 + 2");

		expect(handlePythonCommand).toHaveBeenCalledWith("2 + 2", false);
		expect(showStatus).not.toHaveBeenCalled();
	});

	it("excludes output from context for the doubled sigil", async () => {
		const { ctx, handleBashCommand } = createContext("Worker");
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await ctx.editor.onSubmit?.("!!eza -l");

		expect(handleBashCommand).toHaveBeenCalledWith("eza -l", true);
	});

	it("still sends a slash command back to the main session", async () => {
		const { ctx, handleBashCommand, showStatus, prompt } = createContext("Worker");
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await ctx.editor.onSubmit?.("/compact");

		expect(showStatus).toHaveBeenCalledWith("Slash commands run in the main session — press ←← to return first");
		expect(handleBashCommand).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
	});

	it("treats a bare sigil as prose, not a command", async () => {
		const { ctx, handleBashCommand, prompt } = createContext("Worker");
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		await ctx.editor.onSubmit?.("$HOME is unset");

		expect(handleBashCommand).not.toHaveBeenCalled();
		expect(prompt).toHaveBeenCalledTimes(1);
	});
});
