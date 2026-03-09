// Plugin manifest types — Phase 1 uses TypeScript objects; Phase 2+ will use plugin.json files

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	activationEvents: ActivationEvent[];
	contributes: PluginContributions;
	permissions?: PluginPermission[];
}

export type ActivationEvent =
	| { type: "onStartup" }
	| { type: "onCommand"; command: string }
	| { type: "onView"; viewId: string };

export interface PluginContributions {
	commands?: PluginCommandContribution[];
	panels?: PluginPanelContribution[];
	statusBarItems?: PluginStatusBarItem[];
}

export interface PluginCommandContribution {
	command: string;
	title: string;
	category?: string;
	keybinding?: string;
}

export interface PluginPanelContribution {
	id: string;
	name: string;
	side: "left" | "right";
	icon: string; // inline SVG string using currentColor
}

export interface PluginStatusBarItem {
	id: string;
	text: string;
	tooltip?: string;
	alignment: "left" | "right";
	priority?: number;
	command?: string;
}

export type PluginPermission =
	| "clipboard.read"
	| "clipboard.write"
	| "storage"
	| "terminal.read"
	| "terminal.write"
	| "sessions.read"
	| "notifications";

export interface Disposable {
	dispose(): void;
}
