import { type Change, diffLines, diffWordsWithSpace } from "diff";
import { memo } from "react";
import { highlightSource } from "./syntax";

type DiffPart = Pick<Change, "value" | "removed" | "added">;
type DiffKind = "removed" | "added" | "context";
type DiffRow = { kind: DiffKind; parts: { text: string; changed: boolean }[] };

function lines(parts: DiffPart[], kind: DiffKind, highlight = false): DiffRow[] {
	const rows: DiffRow[] = [];
	let row: DiffRow = { kind, parts: [] };
	for (const part of parts) {
		const fragments = part.value.split("\n");
		for (const [index, text] of fragments.entries()) {
			if (index > 0) {
				rows.push(row);
				row = { kind, parts: [] };
			}
			if (text)
				row.parts.push({
					text,
					changed: highlight && (part.added || part.removed) && text.trim().length > 0,
				});
		}
	}
	if (row.parts.length) rows.push(row);
	return rows;
}
function changedRows(before: DiffPart, after: DiffPart): DiffRow[] {
	const words = diffWordsWithSpace(before.value, after.value, { timeout: 50 });
	if (!words) return [...lines([before], "removed"), ...lines([after], "added")];
	return [
		...lines(
			words.filter((part) => !part.added),
			"removed",
			true,
		),
		...lines(
			words.filter((part) => !part.removed),
			"added",
			true,
		),
	];
}
function diffRows(before: string, after: string): DiffRow[] {
	const changes = diffLines(before, after, { timeout: 50 }) ?? [
		{ value: before, removed: true, added: false },
		{ value: after, removed: false, added: true },
	];
	const rows: DiffRow[] = [];
	for (let index = 0; index < changes.length; index++) {
		const current = changes[index];
		if (!current) continue;
		const next = changes[index + 1];
		if (current.removed && next?.added) {
			rows.push(...changedRows(current, next));
			index++;
		} else {
			rows.push(
				...lines([current], current.removed ? "removed" : current.added ? "added" : "context"),
			);
		}
	}
	return rows;
}
function highlightRow(row: DiffRow, language: string) {
	let offset = 0;
	const ranges: [number, number][] = [];
	for (const part of row.parts) {
		if (part.changed) ranges.push([offset, offset + part.text.length]);
		offset += part.text.length;
	}
	return highlightSource(row.parts.map((part) => part.text).join(""), language, ranges);
}
export const EditDiff = memo(function EditDiff({
	before,
	after,
	language,
}: {
	before: string;
	after: string;
	language: string;
}) {
	const rows = diffRows(before, after);
	return (
		<div className="edit-diff">
			{rows.map((row, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: Diff rows are stateless positions in immutable replacement text.
				<div className={`diff-row diff-${row.kind}`} key={index}>
					<span
						className="diff-sign"
						role="img"
						aria-label={
							row.kind === "removed" ? "Removed" : row.kind === "added" ? "Added" : "Unchanged"
						}
					>
						{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : " "}
					</span>
					<code>{highlightRow(row, language)}</code>
				</div>
			))}
			{before === after && <div className="diff-note">No changes</div>}
		</div>
	);
});
