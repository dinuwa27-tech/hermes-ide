import type { HermesPluginAPI } from "../../PluginAPI";
import { JsonFormatterPanel } from "./JsonFormatterPanel";

let hermesAPI: HermesPluginAPI | null = null;

export function getAPI(): HermesPluginAPI {
	if (!hermesAPI) throw new Error("JSON Formatter plugin not activated");
	return hermesAPI;
}

export function activate(api: HermesPluginAPI) {
	hermesAPI = api;

	api.ui.registerPanel("json-formatter-panel", JsonFormatterPanel);

	api.subscriptions.push(
		api.commands.register("json-formatter.openPanel", () => {
			api.ui.showPanel("json-formatter-panel");
		})
	);

	api.subscriptions.push(
		api.commands.register("json-formatter.format", async () => {
			try {
				const text = await api.clipboard.readText();
				const parsed = JSON.parse(text);
				const formatted = JSON.stringify(parsed, null, 2);
				await api.clipboard.writeText(formatted);
				api.ui.showToast("JSON formatted and copied to clipboard", { type: "success" });
			} catch {
				api.ui.showToast("Clipboard does not contain valid JSON", { type: "error" });
			}
		})
	);

	api.subscriptions.push(
		api.commands.register("json-formatter.minify", async () => {
			try {
				const text = await api.clipboard.readText();
				const parsed = JSON.parse(text);
				const minified = JSON.stringify(parsed);
				await api.clipboard.writeText(minified);
				api.ui.showToast("JSON minified and copied to clipboard", { type: "success" });
			} catch {
				api.ui.showToast("Clipboard does not contain valid JSON", { type: "error" });
			}
		})
	);

	api.subscriptions.push(
		api.commands.register("json-formatter.validate", async () => {
			try {
				const text = await api.clipboard.readText();
				JSON.parse(text);
				api.ui.showToast("Valid JSON", { type: "success" });
			} catch (e) {
				api.ui.showToast(`Invalid JSON: ${e instanceof Error ? e.message : "unknown error"}`, { type: "error" });
			}
		})
	);
}

export function deactivate() {
	hermesAPI = null;
}
