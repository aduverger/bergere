import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

export async function initializeNative() {
	if (Capacitor.getPlatform() !== "ios") return;
	await Keyboard.setAccessoryBarVisible({ isVisible: false });
}

export function onNativeResume(resume: () => void): () => void {
	if (!Capacitor.isNativePlatform()) return () => {};
	let active = true;
	const subscription = App.addListener("resume", () => {
		if (active) resume();
	});
	void subscription.catch(() => console.error("Native foreground listener failed."));
	return () => {
		active = false;
		void subscription.then((handle) => handle.remove()).catch(() => {});
	};
}

export function onNativeKeyboardHeight(change: (height: number) => void): () => void {
	if (Capacitor.getPlatform() !== "ios") return () => {};
	let active = true;
	const update = (height: number) => {
		if (active) change(height);
	};
	const subscriptions = [
		Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => update(keyboardHeight)),
		Keyboard.addListener("keyboardWillHide", () => update(0)),
	];
	for (const subscription of subscriptions)
		void subscription.catch(() => console.error("Native keyboard listener failed."));
	return () => {
		active = false;
		for (const subscription of subscriptions)
			void subscription.then((handle) => handle.remove()).catch(() => {});
	};
}
