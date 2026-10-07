import { createRoot } from "react-dom/client";
import { App } from "./App";
import { gatewayUrl } from "./gateway-url";
import { initializeNative } from "./native";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
async function start() {
	gatewayUrl("/ws", true);
	await initializeNative();
	if (root) createRoot(root).render(<App />);
}
void start().catch((error: unknown) => {
	root.textContent = error instanceof Error ? error.message : "Unable to initialize Bergère.";
});
