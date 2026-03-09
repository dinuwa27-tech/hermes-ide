import { useState, useEffect } from "react";
import type { PluginRuntime, RuntimeStatusBarItem } from "./PluginRuntime";
import type { PluginCommandContribution, PluginPanelContribution } from "./types";

export function usePluginRuntime(runtime: PluginRuntime | null) {
	const [commands, setCommands] = useState<(PluginCommandContribution & { pluginId: string })[]>([]);
	const [panels, setPanels] = useState<(PluginPanelContribution & { pluginId: string })[]>([]);
	const [statusBarItems, setStatusBarItems] = useState<RuntimeStatusBarItem[]>([]);

	useEffect(() => {
		if (!runtime) return;

		const refresh = () => {
			setCommands(runtime.getAllCommands());
			setPanels(runtime.getAllPanels());
			setStatusBarItems(runtime.getAllStatusBarItems());
		};

		// Initial load
		refresh();

		// Subscribe to changes
		return runtime.subscribe(refresh);
	}, [runtime]);

	return { commands, panels, statusBarItems, runtime };
}
