import { type Change, diffLines, diffWordsWithSpace } from "diff";
import { memo } from "react";

type DiffPart = Pick<Change, "value" | "removed" | "added">;
type DiffKind = "removed" | "added" | "context";
type DiffRow = { kind: DiffKind; parts: { text: string; changed: boolean }[] };

function lines(parts: DiffPart[], kind: DiffKind): DiffRow[] {
	const rows: DiffRow[] = [];
	let row: DiffRow = { kind, parts: [] };
	for (const part of parts) {
		const fragments = part.value.split("\n");
		for (const [index, text] of fragments.entries()) {
			if (index > 0) {
				rows.push(row);
				row = { kind, parts: [] };
			}
			if (text) row.parts.push({ text, changed: part.added || part.removed });
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
		),
		...lines(
			words.filter((part) => !part.removed),
			"added",
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
export const EditDiff = memo(function EditDiff({
	before,
	after,
}: {
	before: string;
	after: string;
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
					<code>
						{row.parts.map((part, partIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: Word tokens are stateless positions within a diff row.
							<span key={partIndex} className={part.changed ? "diff-word" : undefined}>
								{part.text}
							</span>
						))}
					</code>
				</div>
			))}
			{before === after && <div className="diff-note">No changes</div>}
		</div>
	);
});
