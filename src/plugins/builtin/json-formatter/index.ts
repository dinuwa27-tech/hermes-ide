import type { PluginModule } from "../../PluginRuntime";
import { manifest } from "./manifest";
import { activate, deactivate } from "./activate";

export const jsonFormatterPlugin: PluginModule = {
	manifest,
	activate,
	deactivate,
};
