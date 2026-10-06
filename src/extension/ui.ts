import { ExtensionEditorComponent, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { DialogBroker } from "./dialogs.js";
export function bridgeDialogs(
	ui: ExtensionUIContext,
	broker: DialogBroker,
	customChanged: (active: boolean) => void,
): () => void {
	for (const name of ["select", "confirm", "input", "editor", "custom"] as const)
		if (
			typeof ui[name] !== "function" ||
			Object.getOwnPropertyDescriptor(ui, name)?.writable === false
		)
			throw new Error("Incompatible Pi dialog API");
	const original = {
		select: ui.select,
		confirm: ui.confirm,
		input: ui.input,
		editor: ui.editor,
		custom: ui.custom,
	};
	const base = { message: "", options: [] as string[], prefill: "" };
	ui.select = async (title, options, opts) =>
		(await broker.request(
			{ ...base, kind: "select", title, options },
			(signal) => original.select.call(ui, title, options, { ...opts, signal }),
			opts,
		)) as string | undefined;
	ui.confirm = async (title, message, opts) =>
		(await broker.request(
			{ ...base, kind: "confirm", title, message },
			(signal) => original.confirm.call(ui, title, message, { ...opts, signal }),
			opts,
		)) === true;
	ui.input = async (title, placeholder, opts) =>
		(await broker.request(
			{ ...base, kind: "input", title, message: placeholder ?? "" },
			(signal) => original.input.call(ui, title, placeholder, { ...opts, signal }),
			opts,
		)) as string | undefined;
	ui.editor = async (title, prefill) =>
		(await broker.request(
			{ ...base, kind: "editor", title, prefill: prefill ?? "" },
			(signal) =>
				original.custom.call(ui, (tui, _theme, keys, done) => {
					const finish = (value: unknown) => {
						signal.removeEventListener("abort", cancel);
						done(value);
					};
					const cancel = () => finish(undefined);
					signal.addEventListener("abort", cancel, { once: true });
					const component = new ExtensionEditorComponent(tui, keys, title, prefill, finish, cancel);
					if (signal.aborted) queueMicrotask(cancel);
					return Object.assign(component, {
						dispose: () => signal.removeEventListener("abort", cancel),
					});
				}) as Promise<string | undefined>,
		)) as string | undefined;
	ui.custom = async (factory, options) => {
		customChanged(true);
		try {
			return (await original.custom.call(ui, factory, options)) as never;
		} finally {
			customChanged(false);
		}
	};
	const installed = {
		select: ui.select,
		confirm: ui.confirm,
		input: ui.input,
		editor: ui.editor,
		custom: ui.custom,
	};
	return () => {
		broker.close();
		for (const name of ["select", "confirm", "input", "editor", "custom"] as const)
			if (ui[name] === installed[name]) Object.assign(ui, { [name]: original[name] });
	};
}
