//! Julia syntax services backed by Fatou's lossless parser.

use fatou_parser::{
	parser,
	syntax::{SyntaxKind, SyntaxNode},
};
use napi::bindgen_prelude::Error;
use napi_derive::napi;

/// A Fatou CST node and its source location.
#[napi(object)]
pub struct JuliaSyntaxMatch {
	/// Stable, caller-facing node kind.
	pub kind:       String,
	/// Exact source covered by the node.
	pub text:       String,
	/// Start byte offset in the UTF-8 source.
	pub byte_start: u32,
	/// End byte offset in the UTF-8 source, exclusive.
	pub byte_end:   u32,
	/// One-based start line.
	pub start_line: u32,
	/// One-based end line.
	pub end_line:   u32,
}

/// In-memory Fatou parse result for requested Julia CST kinds.
#[napi(object)]
pub struct JuliaSyntaxMatchResult {
	/// Matching nodes in source order.
	pub matches:      Vec<JuliaSyntaxMatch>,
	/// Recoverable parser diagnostics. Fatou still returns a lossless CST.
	pub parse_errors: Option<Vec<String>>,
}

fn requested_kind(kind: &str) -> Option<SyntaxKind> {
	match kind {
		"assignment" => Some(SyntaxKind::ASSIGNMENT_EXPR),
		"binary_expression" => Some(SyntaxKind::BINARY_EXPR),
		"for_expression" => Some(SyntaxKind::FOR_EXPR),
		"function_definition" => Some(SyntaxKind::FUNCTION_DEF),
		"index_expression" => Some(SyntaxKind::INDEX_EXPR),
		"macro_call" => Some(SyntaxKind::MACRO_CALL),
		"ternary_expression" => Some(SyntaxKind::TERNARY_EXPR),
		_ => None,
	}
}

fn public_kind(kind: SyntaxKind) -> &'static str {
	match kind {
		SyntaxKind::ASSIGNMENT_EXPR => "assignment",
		SyntaxKind::BINARY_EXPR => "binary_expression",
		SyntaxKind::FOR_EXPR => "for_expression",
		SyntaxKind::FUNCTION_DEF => "function_definition",
		SyntaxKind::INDEX_EXPR => "index_expression",
		SyntaxKind::MACRO_CALL => "macro_call",
		SyntaxKind::TERNARY_EXPR => "ternary_expression",
		_ => unreachable!("only requested kinds reach public_kind"),
	}
}

fn line_at(source: &str, byte_offset: usize) -> u32 {
	let line = source[..byte_offset].split('\n').count();
	u32::try_from(line).unwrap_or(u32::MAX)
}

fn matches_for(source: &str, root: &SyntaxNode, requested: &[SyntaxKind]) -> Vec<JuliaSyntaxMatch> {
	root
		.descendants()
		.filter(|node| requested.contains(&node.kind()))
		.filter_map(|node| {
			let range = node.text_range();
			let start = usize::from(range.start());
			let end = usize::from(range.end());
			Some(JuliaSyntaxMatch {
				kind:       public_kind(node.kind()).to_owned(),
				text:       source.get(start..end)?.to_owned(),
				byte_start: u32::try_from(start).unwrap_or(u32::MAX),
				byte_end:   u32::try_from(end).unwrap_or(u32::MAX),
				start_line: line_at(source, start),
				end_line:   line_at(source, end),
			})
		})
		.collect()
}

/// Parse an in-memory Julia fragment with Fatou and return selected CST nodes.
/// Unknown kind names are rejected so a misspelled rule cannot silently stop
/// firing.
#[napi]
pub fn julia_syntax_matches(
	source: String,
	kinds: Vec<String>,
) -> napi::Result<JuliaSyntaxMatchResult> {
	let requested = kinds
		.iter()
		.map(|kind| {
			requested_kind(kind)
				.ok_or_else(|| Error::from_reason(format!("unsupported Julia syntax kind: {kind}")))
		})
		.collect::<napi::Result<Vec<_>>>()?;
	let parsed = parser::parse(&source);
	let matches = matches_for(&source, &parsed.cst, &requested);
	let parse_errors = if parsed.diagnostics.is_empty() {
		None
	} else {
		Some(
			parsed
				.diagnostics
				.iter()
				.map(|diagnostic| format!("{diagnostic:?}"))
				.collect(),
		)
	};
	Ok(JuliaSyntaxMatchResult { matches, parse_errors })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn finds_long_and_short_functions_losslessly() {
		let source = "# one\nfunction long(x)\n x\nend\n# two\nshort(x) = x\n";
		let parsed = parser::parse(source);
		let matches =
			matches_for(source, &parsed.cst, &[SyntaxKind::FUNCTION_DEF, SyntaxKind::ASSIGNMENT_EXPR]);
		assert_eq!(matches.len(), 2);
		assert_eq!(matches[0].kind, "function_definition");
		assert_eq!(matches[0].start_line, 2);
		assert_eq!(matches[1].text, "short(x) = x");
		assert_eq!(matches[1].start_line, 6);
	}

	#[test]
	fn reports_nested_control_flow_nodes_by_utf8_byte_range() {
		let source = "π && error(\"bad\")\nx ? y : z\n";
		let parsed = parser::parse(source);
		let matches =
			matches_for(source, &parsed.cst, &[SyntaxKind::BINARY_EXPR, SyntaxKind::TERNARY_EXPR]);
		assert_eq!(matches.len(), 2);
		assert_eq!(
			&source.as_bytes()[matches[0].byte_start as usize..matches[0].byte_end as usize],
			"π && error(\"bad\")".as_bytes()
		);
		assert_eq!(matches[1].text, "x ? y : z");
	}

	#[test]
	fn finds_for_loops_and_index_expressions() {
		let source = "for i in eachindex(xs)\n use(i, xs[i])\nend\n";
		let parsed = parser::parse(source);
		let matches =
			matches_for(source, &parsed.cst, &[SyntaxKind::FOR_EXPR, SyntaxKind::INDEX_EXPR]);
		assert_eq!(matches.len(), 2);
		assert_eq!(matches[0].kind, "for_expression");
		assert_eq!(matches[1].text, "xs[i]");
	}
}
