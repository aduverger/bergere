import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { authorized } from "../src/server/auth";
import { config } from "../src/server/config";
import { gatewayOrigin, gatewayUrl } from "../src/web/gateway-url";
import { initializeNative, onNativeResume } from "../src/web/native";

const native = vi.hoisted(() => ({ enabled: false, listen: vi.fn(), keyboard: vi.fn() }));
vi.mock("@capacitor/core", () => ({
	Capacitor: {
		isNativePlatform: () => native.enabled,
		getPlatform: () => (native.enabled ? "ios" : "web"),
	},
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: native.listen } }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: { setAccessoryBarVisible: native.keyboard } }));
afterEach(() => {
	native.enabled = false;
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

it("keeps web same-origin and requires an explicit secure native endpoint", () => {
	expect(gatewayOrigin(false, "https://other.example", "http://localhost:8787")).toBe(
		"http://localhost:8787",
	);
	for (const value of [
		undefined,
		"http://host",
		"https://host/path",
		"https://user:secret@host",
		"https://host?query",
		"https://host/#fragment",
	])
		expect(() => gatewayOrigin(true, value, "capacitor://localhost")).toThrow();
	native.enabled = true;
	vi.stubGlobal("location", { origin: "capacitor://localhost" });
	vi.stubEnv("VITE_BERGERE_GATEWAY", "https://host.tail.ts.net:3504");
	expect(gatewayUrl("/ws", true)).toBe("wss://host.tail.ts.net:3504/ws");
	expect(gatewayUrl("/api/tool?id=one")).toBe("https://host.tail.ts.net:3504/api/tool?id=one");
});

it("requires native opt-in without bypassing identity or host validation", () => {
	const c = {
		origin: "https://host.ts.net:3504",
		login: "owner@example.com",
		local: false,
		nativeOrigin: "capacitor://localhost",
	};
	const headers = {
		host: "host.ts.net:3504",
		origin: c.nativeOrigin,
		"tailscale-user-login": c.login,
		"sec-fetch-site": "cross-site",
	};
	const req = (overrides = {}) => {
		const request = new IncomingMessage(new Socket());
		request.headers = { ...headers, ...overrides };
		return request;
	};
	for (const upgrade of [false, true]) {
		expect(authorized(req(), c, upgrade)).toBe(true);
		expect(authorized(req(), { ...c, nativeOrigin: undefined }, upgrade)).toBe(false);
		for (const overrides of [
			{ origin: "null" },
			{ origin: "https://evil.example" },
			{ origin: "capacitor://evil" },
			{ host: "evil.example" },
			{ "tailscale-user-login": undefined },
			{ "tailscale-user-login": "other@example.com" },
		])
			expect(authorized(req(overrides), c, upgrade)).toBe(false);
	}
	expect(() => config({ BERGERE_LOCAL: "1", BERGERE_NATIVE_ORIGIN: "*" })).toThrow();
});

it("only configures the native keyboard and releases a late foreground subscription", async () => {
	await initializeNative();
	expect(native.keyboard).not.toHaveBeenCalled();
	onNativeResume(() => {})();
	expect(native.listen).not.toHaveBeenCalled();
	native.enabled = true;
	await initializeNative();
	expect(native.keyboard).toHaveBeenCalledWith({ isVisible: false });
	const remove = vi.fn(async () => {});
	let notify = () => {};
	let resolve = (_value: { remove: typeof remove }) => {};
	native.listen.mockImplementation((_event, callback: () => void) => {
		notify = callback;
		return new Promise((r) => {
			resolve = r;
		});
	});
	const resumed = vi.fn();
	const stop = onNativeResume(resumed);
	notify();
	expect(resumed).toHaveBeenCalledTimes(1);
	stop();
	notify();
	resolve({ remove });
	await Promise.resolve();
	expect(remove).toHaveBeenCalledTimes(1);
	expect(resumed).toHaveBeenCalledTimes(1);
});
