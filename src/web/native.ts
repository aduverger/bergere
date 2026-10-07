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
