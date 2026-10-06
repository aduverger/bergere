import { type Change, diffLines, diffWordsWithSpace } from "diff";
import { memo, type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
type DiffEntry = DiffRow | { kind: "modified"; before: DiffRow; after: DiffRow };

function diffRows(before: string, after: string): DiffEntry[] {
	const changes = diffLines(before, after, { timeout: 50 }) ?? [
		{ value: before, removed: true, added: false },
		{ value: after, removed: false, added: true },
	];
	const rows: DiffEntry[] = [];
	for (let index = 0; index < changes.length; index++) {
		const current = changes[index];
		if (!current) continue;
		const next = changes[index + 1];
		if (current.removed && next?.added) {
			const replacement = changedRows(current, next);
			const [removed, added] = replacement;
			if (replacement.length === 2 && removed?.kind === "removed" && added?.kind === "added") {
				rows.push({ kind: "modified", before: removed, after: added });
			} else {
				rows.push(...replacement);
			}
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
function DiffLine({
	row,
	language,
	sign,
	modified = false,
}: {
	row: DiffRow;
	language: string;
	sign?: ReactNode;
	modified?: boolean;
}) {
	return (
		<div className={`diff-row diff-${modified ? "modified" : row.kind}`}>
			{sign ?? (
				<span className="diff-sign" role="img" aria-label={row.kind}>
					{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : " "}
				</span>
			)}
			<code>{highlightRow(row, language)}</code>
		</div>
	);
}

function ModifiedLine({
	entry,
	language,
}: {
	entry: Extract<DiffEntry, { kind: "modified" }>;
	language: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const restoreFocus = useRef(false);
	useLayoutEffect(() => {
		if (restoreFocus.current) {
			button.current?.focus({ preventScroll: true });
			restoreFocus.current = false;
		}
	});
	return (expanded ? [entry.before, entry.after] : [entry.after]).map((row, index) => (
		<DiffLine
			key={expanded ? row.kind : "modified"}
			row={row}
			language={language}
			modified={!expanded}
			sign={
				<button
					ref={index === 0 ? button : undefined}
					type="button"
					className="diff-sign"
					aria-label={expanded ? `Collapse ${row.kind} line` : "Expand modified line"}
					aria-expanded={expanded}
					onClick={() => {
						restoreFocus.current = true;
						setExpanded(!expanded);
					}}
				>
					{expanded ? (row.kind === "removed" ? "−" : "+") : "~"}
				</button>
			}
		/>
	));
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
			{rows.map((row, index) =>
				row.kind === "modified" ? (
					<ModifiedLine
						key={JSON.stringify([index, row.before, row.after])}
						entry={row}
						language={language}
					/>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: Static rows have no state.
					<DiffLine key={index} row={row} language={language} />
				),
			)}
			{before === after && <div className="diff-note">No changes</div>}
		</div>
	);
});
