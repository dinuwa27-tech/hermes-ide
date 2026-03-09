import { describe, it, expect } from "vitest";
import { manifest } from "../builtin/json-formatter/manifest";

describe("JSON Formatter Plugin", () => {
	describe("manifest", () => {
		it("should have correct plugin ID", () => {
			expect(manifest.id).toBe("hermes-hq.json-formatter");
		});

		it("should declare onStartup activation event", () => {
			expect(manifest.activationEvents).toContainEqual({ type: "onStartup" });
		});

		it("should declare 4 commands", () => {
			expect(manifest.contributes.commands).toHaveLength(4);
		});

		it("should declare a left panel", () => {
			expect(manifest.contributes.panels).toHaveLength(1);
			expect(manifest.contributes.panels![0].side).toBe("left");
		});

		it("should declare clipboard permissions", () => {
			expect(manifest.permissions).toContain("clipboard.read");
			expect(manifest.permissions).toContain("clipboard.write");
		});

		it("should have a status bar item", () => {
			expect(manifest.contributes.statusBarItems).toHaveLength(1);
			expect(manifest.contributes.statusBarItems![0].alignment).toBe("right");
		});
	});
});
