import type { PluginModule } from "../PluginRuntime";
import { jsonFormatterPlugin } from "./json-formatter";

export const builtinPlugins: PluginModule[] = [
	jsonFormatterPlugin,
];
