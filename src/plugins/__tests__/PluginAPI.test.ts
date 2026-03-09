import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPluginAPI, PermissionDeniedError, type PluginAPICallbacks } from "../PluginAPI";

// Polyfill localStorage for Node test environment
const store = new Map<string, string>();
const localStorageMock: Storage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => { store.set(key, value); },
	removeItem: (key: string) => { store.delete(key); },
	clear: () => { store.clear(); },
	get length() { return store.size; },
	key: (index: number) => [...store.keys()][index] ?? null,
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

function createMockCallbacks(): PluginAPICallbacks {
	return {
		onPanelToggle: vi.fn(),
		onPanelShow: vi.fn(),
		onPanelHide: vi.fn(),
		onToast: vi.fn(),
		onStatusBarUpdate: vi.fn(),
	};
}

describe("createPluginAPI", () => {
	let callbacks: PluginAPICallbacks;
	let commandHandlers: Map<string, () => void | Promise<void>>;
	let panelComponents: Map<string, React.ComponentType<any>>;

	beforeEach(() => {
		callbacks = createMockCallbacks();
		commandHandlers = new Map();
		panelComponents = new Map();
		store.clear();
	});

	describe("permissions", () => {
		it("should allow clipboard read when permission is granted", async () => {
			const api = createPluginAPI("test", new Set(["clipboard.read"]), callbacks, commandHandlers, panelComponents);
			// Note: In test environment, navigator.clipboard may not be available
			// This test verifies the permission check passes, not the actual clipboard read
			expect(() => api.clipboard.readText()).not.toThrow(PermissionDeniedError);
		});

		it("should deny clipboard read when permission is not granted", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			expect(() => api.clipboard.readText()).toThrow(PermissionDeniedError);
		});

		it("should deny clipboard write when permission is not granted", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			expect(() => api.clipboard.writeText("test")).toThrow(PermissionDeniedError);
		});

		it("should deny storage when permission is not granted", async () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			await expect(api.storage.get("key")).rejects.toThrow(PermissionDeniedError);
		});

		it("should allow storage when permission is granted", async () => {
			const api = createPluginAPI("test", new Set(["storage"]), callbacks, commandHandlers, panelComponents);
			await api.storage.set("key", "value");
			const result = await api.storage.get("key");
			expect(result).toBe("value");
		});
	});

	describe("commands", () => {
		it("should register command handlers", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			const handler = vi.fn();
			api.commands.register("test.cmd", handler);
			expect(commandHandlers.has("test.cmd")).toBe(true);
		});

		it("should dispose command handlers", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			const handler = vi.fn();
			const disposable = api.commands.register("test.cmd", handler);
			disposable.dispose();
			expect(commandHandlers.has("test.cmd")).toBe(false);
		});

		it("should execute command handlers", async () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			const handler = vi.fn();
			api.commands.register("test.cmd", handler);
			await api.commands.execute("test.cmd");
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("ui", () => {
		it("should register panel components", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			const Component = () => null;
			api.ui.registerPanel("panel-1", Component as any);
			expect(panelComponents.get("panel-1")).toBe(Component);
		});

		it("should call onPanelShow callback", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			api.ui.showPanel("panel-1");
			expect(callbacks.onPanelShow).toHaveBeenCalledWith("panel-1");
		});

		it("should call onPanelHide callback", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			api.ui.hidePanel("panel-1");
			expect(callbacks.onPanelHide).toHaveBeenCalledWith("panel-1");
		});

		it("should call onToast callback", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			api.ui.showToast("Hello", { type: "success" });
			expect(callbacks.onToast).toHaveBeenCalledWith("Hello", "success");
		});

		it("should call onStatusBarUpdate callback", () => {
			const api = createPluginAPI("test", new Set(), callbacks, commandHandlers, panelComponents);
			api.ui.updateStatusBarItem("item-1", { text: "Updated" });
			expect(callbacks.onStatusBarUpdate).toHaveBeenCalledWith("item-1", { text: "Updated" });
		});
	});

	describe("storage", () => {
		it("should scope storage keys by plugin ID", async () => {
			const api = createPluginAPI("my-plugin", new Set(["storage"]), callbacks, commandHandlers, panelComponents);
			await api.storage.set("key", "value");
			// Verify it's stored with the correct prefix
			expect(localStorage.getItem("plugin.my-plugin.key")).toBe("value");
		});

		it("should delete storage keys", async () => {
			const api = createPluginAPI("my-plugin", new Set(["storage"]), callbacks, commandHandlers, panelComponents);
			await api.storage.set("key", "value");
			await api.storage.delete("key");
			const result = await api.storage.get("key");
			expect(result).toBeNull();
		});
	});
});
