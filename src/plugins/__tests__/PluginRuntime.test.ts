import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginRuntime, type PluginModule } from "../PluginRuntime";
import type { PluginAPICallbacks } from "../PluginAPI";

function createMockCallbacks(): PluginAPICallbacks {
	return {
		onPanelToggle: vi.fn(),
		onPanelShow: vi.fn(),
		onPanelHide: vi.fn(),
		onToast: vi.fn(),
		onStatusBarUpdate: vi.fn(),
	};
}

function createTestPlugin(overrides?: Partial<PluginModule>): PluginModule {
	return {
		manifest: {
			id: "test.plugin",
			name: "Test Plugin",
			version: "1.0.0",
			description: "A test plugin",
			author: "Test",
			activationEvents: [{ type: "onStartup" }],
			contributes: {
				commands: [
					{ command: "test.hello", title: "Hello", category: "Test" },
				],
				panels: [
					{ id: "test-panel", name: "Test", side: "left" as const, icon: "<svg></svg>" },
				],
				statusBarItems: [
					{ id: "test.status", text: "Test", alignment: "right" as const, priority: 50 },
				],
			},
			permissions: ["clipboard.read", "clipboard.write"],
		},
		activate: vi.fn(),
		deactivate: vi.fn(),
		...overrides,
	};
}

describe("PluginRuntime", () => {
	let runtime: PluginRuntime;
	let callbacks: PluginAPICallbacks;

	beforeEach(() => {
		callbacks = createMockCallbacks();
		runtime = new PluginRuntime(callbacks);
	});

	describe("register", () => {
		it("should register a plugin", () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			expect(runtime.getPluginCount()).toBe(1);
		});

		it("should not register duplicate plugins", () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			runtime.register(plugin);
			expect(runtime.getPluginCount()).toBe(1);
		});
	});

	describe("activate", () => {
		it("should call activate function on the plugin module", async () => {
			const activate = vi.fn();
			const plugin = createTestPlugin({ activate });
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			expect(activate).toHaveBeenCalledOnce();
			expect(activate).toHaveBeenCalledWith(expect.objectContaining({
				ui: expect.any(Object),
				commands: expect.any(Object),
				clipboard: expect.any(Object),
				storage: expect.any(Object),
				subscriptions: expect.any(Array),
			}));
		});

		it("should handle activation errors gracefully", async () => {
			const plugin = createTestPlugin({
				activate: vi.fn(() => { throw new Error("Activation failed"); }),
			});
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			// Should not throw — error is caught internally
			expect(runtime.getPluginCount()).toBe(1);
		});

		it("should not activate an already active plugin", async () => {
			const activate = vi.fn();
			const plugin = createTestPlugin({ activate });
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			await runtime.activate("test.plugin");
			expect(activate).toHaveBeenCalledOnce();
		});
	});

	describe("deactivate", () => {
		it("should call deactivate function", async () => {
			const deactivate = vi.fn();
			const plugin = createTestPlugin({ deactivate });
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			await runtime.deactivate("test.plugin");
			expect(deactivate).toHaveBeenCalledOnce();
		});

		it("should dispose all subscriptions", async () => {
			const disposeFn = vi.fn();
			const plugin = createTestPlugin({
				activate: (api) => {
					api.subscriptions.push({ dispose: disposeFn });
				},
			});
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			await runtime.deactivate("test.plugin");
			expect(disposeFn).toHaveBeenCalledOnce();
		});
	});

	describe("activateStartupPlugins", () => {
		it("should activate plugins with onStartup event", async () => {
			const activate = vi.fn();
			const plugin = createTestPlugin({ activate });
			runtime.register(plugin);
			await runtime.activateStartupPlugins();
			expect(activate).toHaveBeenCalledOnce();
		});

		it("should not activate plugins without onStartup event", async () => {
			const activate = vi.fn();
			const plugin = createTestPlugin({
				activate,
				manifest: {
					...createTestPlugin().manifest,
					activationEvents: [{ type: "onCommand", command: "test.cmd" }],
				},
			});
			runtime.register(plugin);
			await runtime.activateStartupPlugins();
			expect(activate).not.toHaveBeenCalled();
		});
	});

	describe("commands", () => {
		it("should return commands from active plugins", async () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			const commands = runtime.getAllCommands();
			expect(commands).toHaveLength(1);
			expect(commands[0].command).toBe("test.hello");
			expect(commands[0].pluginId).toBe("test.plugin");
		});

		it("should execute registered command handlers", async () => {
			const handler = vi.fn();
			const plugin = createTestPlugin({
				activate: (api) => {
					api.commands.register("test.hello", handler);
				},
			});
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			await runtime.executeCommand("test.hello");
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("panels", () => {
		it("should return panels from registered plugins", () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			const panels = runtime.getAllPanels();
			expect(panels).toHaveLength(1);
			expect(panels[0].id).toBe("test-panel");
		});

		it("should return registered panel components", async () => {
			const MockComponent = () => null;
			const plugin = createTestPlugin({
				activate: (api) => {
					api.ui.registerPanel("test-panel", MockComponent as any);
				},
			});
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			expect(runtime.getPanelComponent("test-panel")).toBe(MockComponent);
		});
	});

	describe("status bar items", () => {
		it("should return status bar items from active plugins", async () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			const items = runtime.getAllStatusBarItems();
			expect(items).toHaveLength(1);
			expect(items[0].text).toBe("Test");
		});

		it("should apply overrides to status bar items", async () => {
			const plugin = createTestPlugin();
			runtime.register(plugin);
			await runtime.activate("test.plugin");
			runtime.updateStatusBarItem("test.status", { text: "Updated", visible: false });
			const items = runtime.getAllStatusBarItems();
			expect(items[0].text).toBe("Updated");
			expect(items[0].visible).toBe(false);
		});
	});

	describe("subscribe", () => {
		it("should notify listeners on register", () => {
			const listener = vi.fn();
			runtime.subscribe(listener);
			runtime.register(createTestPlugin());
			expect(listener).toHaveBeenCalled();
		});

		it("should notify listeners on activate", async () => {
			const listener = vi.fn();
			runtime.register(createTestPlugin());
			runtime.subscribe(listener);
			await runtime.activate("test.plugin");
			expect(listener).toHaveBeenCalled();
		});

		it("should clean up on unsubscribe", () => {
			const listener = vi.fn();
			const unsub = runtime.subscribe(listener);
			unsub();
			runtime.register(createTestPlugin());
			expect(listener).not.toHaveBeenCalled();
		});
	});
});
