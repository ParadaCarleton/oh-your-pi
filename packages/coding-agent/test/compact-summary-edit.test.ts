import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { getLatestCompactionEntry } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { executeAcpBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import type { SlashCommandRuntime, TuiSlashCommandRuntime } from "@oh-my-pi/pi-coding-agent/slash-commands/types";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("compaction summary editing (issue #8281)", () => {
	it("updates the latest compaction summary in memory and in rebuilt context", async () => {
		const manager = SessionManager.inMemory();
		const id = manager.appendCompaction("original summary", "orig", "entry-1", 100);

		const editedId = await manager.updateLatestCompactionSummary("edited summary");

		expect(editedId).toBe(id);
		expect(getLatestCompactionEntry(manager.getBranch())?.summary).toBe("edited summary");
		// The live model context is rebuilt from entries, so the edit shows up
		// in the next turn's context without any extra synchronization.
		const serialized = JSON.stringify(manager.buildSessionContext());
		expect(serialized).toContain("edited summary");
		expect(serialized).not.toContain("original summary");
	});

	it("returns null when the session has no compaction entry", async () => {
		const manager = SessionManager.inMemory();
		expect(await manager.updateLatestCompactionSummary("edited summary")).toBeNull();
	});

	it("rewrites the OpenAI remote-compaction replay summary on edit (#8281 review)", async () => {
		const manager = SessionManager.inMemory();
		const remote = {
			provider: "openai",
			replacementHistory: [
				{ type: "compaction_summary", summary: "original remote summary" },
				{ type: "message", role: "user", content: [{ type: "input_text", text: "kept" }] },
			],
		};
		manager.appendCompaction("original summary", "orig", "entry-1", 100, {
			preserveData: { openaiRemoteCompaction: remote },
		});

		await manager.updateLatestCompactionSummary("edited summary");

		const entry = getLatestCompactionEntry(manager.getBranch());
		const payload = entry?.preserveData?.openaiRemoteCompaction as {
			replacementHistory?: Array<{ type?: string; summary?: string }>;
		};
		const summaryItem = payload?.replacementHistory?.find(item => item.type === "compaction_summary");
		expect(summaryItem?.summary).toBe("edited summary");
		// Non-summary replay items are untouched.
		const messageItem = payload?.replacementHistory?.find(item => item.type === "message");
		expect(messageItem?.summary).toBeUndefined();
	});

	it("persists the edit so a resume keeps it", async () => {
		using tempDir = TempDir.createSync("@omp-compact-edit-");
		const manager = SessionManager.create(tempDir.path(), tempDir.path());
		// Brand-new sessions only write a file once they have an assistant
		// message; append one so the lazy gate lets entries reach disk.
		manager.appendMessage({ role: "assistant", content: "hi", timestamp: 1 } as never);
		manager.appendCompaction("original summary", "orig", "entry-1", 100);
		await manager.updateLatestCompactionSummary("edited summary");
		await manager.flush();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected a persisted session file");

		const reopened = await SessionManager.open(sessionFile, tempDir.path());
		expect(getLatestCompactionEntry(reopened.getBranch())?.summary).toBe("edited summary");
	});
});

describe("/compact-edit dispatch (issue #8281)", () => {
	function tuiRuntime(manager: SessionManager, edited?: string) {
		const showHookEditor = vi.fn(async () => edited);
		const showStatus = vi.fn();
		const showWarning = vi.fn();
		const runtime = {
			ctx: { sessionManager: manager, showHookEditor, showStatus, showWarning } as unknown as InteractiveModeContext,
		} as TuiSlashCommandRuntime;
		return { showHookEditor, showStatus, showWarning, runtime };
	}

	it("opens the editor with the current summary and persists the edit", async () => {
		const manager = SessionManager.inMemory();
		manager.appendCompaction("original summary", "orig", "entry-1", 100);
		const h = tuiRuntime(manager, "edited summary");
		const rebuildContextAfterCompactionEdit = vi.fn();
		h.runtime.ctx.session = { rebuildContextAfterCompactionEdit } as never;

		await executeBuiltinSlashCommand("/compact-edit", h.runtime);

		expect(h.showHookEditor).toHaveBeenCalledWith("Edit compaction summary", "original summary");
		expect(getLatestCompactionEntry(manager.getBranch())?.summary).toBe("edited summary");
		expect(rebuildContextAfterCompactionEdit).toHaveBeenCalled();
		expect(h.showStatus).toHaveBeenCalledWith("Compaction summary updated.");
		expect(h.showWarning).not.toHaveBeenCalled();
	});

	it("warns when the session has no compaction summary yet", async () => {
		const manager = SessionManager.inMemory();
		const h = tuiRuntime(manager, "edited summary");

		await executeBuiltinSlashCommand("/compact-edit", h.runtime);

		expect(h.showWarning).toHaveBeenCalledWith("No compaction summary to edit yet.");
		expect(h.showHookEditor).not.toHaveBeenCalled();
	});

	it("keeps the summary when the editor is cancelled", async () => {
		const manager = SessionManager.inMemory();
		manager.appendCompaction("original summary", "orig", "entry-1", 100);
		const h = tuiRuntime(manager, undefined);

		await executeBuiltinSlashCommand("/compact-edit", h.runtime);

		expect(getLatestCompactionEntry(manager.getBranch())?.summary).toBe("original summary");
		expect(h.showStatus).not.toHaveBeenCalled();
	});

	it("reports interactive-only over ACP instead of mutating silently", async () => {
		const manager = SessionManager.inMemory();
		manager.appendCompaction("original summary", "orig", "entry-1", 100);
		const output = vi.fn();
		const runtime = { sessionManager: manager, output } as unknown as SlashCommandRuntime;

		await executeAcpBuiltinSlashCommand("/compact-edit", runtime);

		expect(output).toHaveBeenCalledWith(expect.stringContaining("interactive-only"));
		expect(getLatestCompactionEntry(manager.getBranch())?.summary).toBe("original summary");
	});
});
