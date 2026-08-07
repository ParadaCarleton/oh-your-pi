#!/usr/bin/env bun
// Compile the fork worktree into a standalone `omp` binary for this host.
//
// The repo's own release builder (scripts/ci-release-build-binaries.ts) cross
// compiles five targets, signs Darwin binaries and writes install metadata.
// None of that applies here, so this reuses the shared compile helper directly
// and lets Bun target the host.
//
// Untracked on purpose: it belongs to the ompf launcher, not to the fork's
// commits, which have to stay clean for upstream PRs.
import { createRequire } from "node:module";
import * as path from "node:path";
import { compileCodingAgent } from "../packages/coding-agent/scripts/compile-binary";

const repoRoot = path.join(import.meta.dir, "..");
const outfile = process.argv[2];
if (!outfile) throw new Error("usage: ompf-compile.ts <outfile>");

const manifest: unknown = createRequire(import.meta.url)("@huggingface/transformers/package.json");
if (typeof manifest !== "object" || manifest === null || !("version" in manifest) || typeof manifest.version !== "string") {
	throw new Error("@huggingface/transformers package manifest has no string version");
}

// The stats dashboard is served from an archive embedded in the binary; its
// source file is committed empty and populated only for a build. Reset it
// afterwards, or the worktree stays dirty and ompf refuses to auto-update.
await Bun.$`bun run gen:stats`.cwd(path.join(repoRoot, "packages", "stats")).quiet();
try {
	await compileCodingAgent({
		repoRoot,
		entrypoint: path.join(repoRoot, "packages", "coding-agent", "src", "cli.ts"),
		outfile,
		transformersVersion: manifest.version,
		// Release builds minify identifiers; skipping it trades a little size for
		// a faster local build and readable stack traces.
		minifyIdentifiers: false,
	});
} finally {
	await Bun.$`bun run gen:stats:reset`.cwd(path.join(repoRoot, "packages", "stats")).quiet().nothrow();
}
