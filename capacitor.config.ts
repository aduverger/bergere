import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

const config: CapacitorConfig = {
	appId: "com.aduverger.bergere",
	appName: "Bergère",
	webDir: "dist/web",
	backgroundColor: "#161514",
	server: { hostname: "localhost", iosScheme: "capacitor" },
	plugins: { Keyboard: { resize: KeyboardResize.None, style: KeyboardStyle.Dark } },
};

export default config;
