import { randomUUID } from "node:crypto";
import type { Dialog } from "../shared/protocol.js";
export class DialogBroker {
	private pending = new Map<
		string,
		{
			dialog: Dialog;
			resolve: (value: string | boolean | undefined) => void;
			controller: AbortController;
			cleanup: () => void;
		}
	>();
	constructor(private changed: () => void) {}
	get dialogs(): Dialog[] {
		return [...this.pending.values()].map((p) => p.dialog);
	}
	request(
		dialog: Omit<Dialog, "id">,
		show: (signal: AbortSignal) => Promise<string | boolean | undefined>,
		options?: { signal?: AbortSignal; timeout?: number },
	): Promise<string | boolean | undefined> {
		const id = randomUUID();
		const controller = new AbortController();
		return new Promise((resolve) => {
			const cancel = () => this.answer(id, "", true);
			const timer =
				options?.timeout === undefined ? undefined : setTimeout(cancel, options.timeout);
			const cleanup = () => {
				clearTimeout(timer);
				options?.signal?.removeEventListener("abort", cancel);
			};
			this.pending.set(id, {
				dialog: { ...dialog, id },
				resolve,
				controller,
				cleanup,
			});
			options?.signal?.addEventListener("abort", cancel, { once: true });
			if (options?.signal?.aborted) {
				cancel();
				return;
			}
			this.changed();
			Promise.resolve()
				.then(() => (controller.signal.aborted ? undefined : show(controller.signal)))
				.then(
					(value) => {
						if (!controller.signal.aborted) this.answer(id, value ?? "", value === undefined);
					},
					() => {
						if (!controller.signal.aborted) cancel();
					},
				);
		});
	}
	answer(id: string, value: string | boolean, cancelled: boolean): boolean {
		const p = this.pending.get(id);
		if (!p) return false;
		if (!cancelled) {
			if (p.dialog.kind === "confirm" ? typeof value !== "boolean" : typeof value !== "string")
				return false;
			if (p.dialog.kind === "select" && !p.dialog.options.includes(String(value))) return false;
		}
		this.pending.delete(id);
		p.cleanup();
		p.controller.abort();
		p.resolve(cancelled ? undefined : value);
		this.changed();
		return true;
	}
	close() {
		for (const id of this.pending.keys()) this.answer(id, "", true);
	}
}
