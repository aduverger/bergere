import { ArrowUp, Plus, SlidersHorizontal, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Block, Command, Snapshot } from "../shared/protocol";

export type Attachment = Extract<Block, { type: "image" }> & { id: string };

export function Composer({
	draft,
	attachments,
	snapshot,
	disabled,
	promptDisabled,
	online,
	ready,
	command,
	setDraft,
	attach,
	removeAttachment,
}: {
	draft: string;
	attachments: Attachment[];
	snapshot: Snapshot | undefined;
	disabled: boolean;
	promptDisabled: boolean;
	online: boolean;
	ready: boolean;
	command: (action: Command["action"]) => void;
	setDraft: (text: string) => void;
	attach: (files: FileList | null) => Promise<void>;
	removeAttachment: (id: string) => void;
}) {
	const file = useRef<HTMLInputElement>(null);
	const settings = useRef<HTMLDialogElement>(null);
	const [delivery, setDelivery] = useState<"steer" | "followUp">("steer");
	return (
		<>
			<form
				className="composer"
				onSubmit={(e) => {
					e.preventDefault();
					if (!promptDisabled && (draft.trim() || attachments.length))
						command({
							kind: "prompt",
							text: draft,
							images: attachments,
							delivery: snapshot?.busy ? delivery : "send",
						});
				}}
				onPaste={(e) => {
					if (e.clipboardData.files.length) {
						e.preventDefault();
						void attach(e.clipboardData.files);
					}
				}}
			>
				{!!attachments.length && (
					<div className="attachments">
						{attachments.map((a, i) => (
							<button
								type="button"
								aria-label={`Remove attachment ${i + 1}`}
								key={a.id}
								onClick={() => removeAttachment(a.id)}
							>
								<img alt={`Attachment ${i + 1}`} src={`data:${a.mimeType};base64,${a.data}`} />
								<X aria-hidden="true" size={16} />
							</button>
						))}
					</div>
				)}
				<textarea
					aria-label="Message"
					placeholder={snapshot?.busy ? "Steer the current run…" : "Message Pi…"}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					rows={1}
					onKeyDown={(e) => {
						if (
							e.key === "Enter" &&
							!e.shiftKey &&
							!e.nativeEvent.isComposing &&
							matchMedia("(pointer:fine)").matches
						) {
							e.preventDefault();
							e.currentTarget.form?.requestSubmit();
						}
					}}
				/>
				<div className="controls">
					<input
						ref={file}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						multiple
						hidden
						onChange={(e) => {
							void attach(e.target.files);
							e.target.value = "";
						}}
					/>
					<button
						type="button"
						className="subtle icon-button"
						aria-label="Attach images"
						disabled={promptDisabled}
						onClick={() => file.current?.click()}
					>
						<Plus aria-hidden="true" />
					</button>
					<button
						type="button"
						className="subtle icon-button"
						aria-label="Message settings"
						aria-haspopup="dialog"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => settings.current?.showModal()}
					>
						<SlidersHorizontal aria-hidden="true" />
					</button>
					<span className="spacer" />
					{snapshot?.busy && (
						<button
							type="button"
							className="icon-button"
							aria-label="Stop"
							disabled={!online || !ready}
							onClick={() => command({ kind: "abort" })}
						>
							<Square aria-hidden="true" size={16} fill="currentColor" />
						</button>
					)}
					<button
						type="submit"
						className="send icon-button"
						aria-label="Send message"
						disabled={promptDisabled || (!draft.trim() && !attachments.length)}
					>
						<ArrowUp aria-hidden="true" />
					</button>
				</div>
			</form>
			<dialog ref={settings} className="message-settings" aria-labelledby="settings-title">
				{/* biome-ignore lint/a11y/noAutofocus: A user-opened modal focuses its heading instead of the native model selector. */}
				<h2 id="settings-title" tabIndex={-1} autoFocus>
					Message settings
				</h2>
				<select
					aria-label="Model"
					value={snapshot?.model ?? ""}
					disabled={disabled}
					onChange={(e) => {
						const m = snapshot?.models.find((m) => `${m.provider}/${m.id}` === e.target.value);
						if (m)
							command({
								kind: "model",
								provider: m.provider,
								modelId: m.id,
							});
					}}
				>
					<option value="">Model</option>
					{snapshot?.models.map((m) => (
						<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
							{m.name}
						</option>
					))}
				</select>
				<select
					aria-label="Thinking level"
					value={snapshot?.thinking ?? "off"}
					disabled={disabled}
					onChange={(e) => command({ kind: "thinking", level: e.target.value as "off" })}
				>
					{["off", "minimal", "low", "medium", "high", "xhigh"].map((l) => (
						<option key={l}>{l}</option>
					))}
				</select>
				{snapshot?.busy && (
					<select
						aria-label="Delivery"
						value={delivery}
						onChange={(e) => setDelivery(e.target.value as "steer" | "followUp")}
					>
						<option value="steer">Steer</option>
						<option value="followUp">Follow up</option>
					</select>
				)}

				<button type="button" onClick={() => settings.current?.close()}>
					Done
				</button>
			</dialog>
		</>
	);
}
