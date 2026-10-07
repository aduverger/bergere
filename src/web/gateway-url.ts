import { Capacitor } from "@capacitor/core";

export function gatewayOrigin(native: boolean, configured: string | undefined, webOrigin: string) {
	if (!native) return webOrigin;
	if (!configured)
		throw new Error(
			"Build the iOS app with VITE_BERGERE_GATEWAY set to your HTTPS gateway origin.",
		);
	const url = new URL(configured);
	if (url.protocol !== "https:" || url.origin !== configured || url.username || url.password)
		throw new Error("VITE_BERGERE_GATEWAY must be a plain HTTPS origin, including its port.");
	return url.origin;
}

export function gatewayUrl(path: string, websocket = false): string {
	const origin = gatewayOrigin(
		Capacitor.isNativePlatform(),
		import.meta.env.VITE_BERGERE_GATEWAY,
		location.origin,
	);
	const url = new URL(path, origin);
	if (websocket) url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.href;
}
