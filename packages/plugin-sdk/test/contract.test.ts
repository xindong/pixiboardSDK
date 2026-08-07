import { describe, expect, expectTypeOf, it } from "vitest";
import * as pluginSdk from "../src/index";

describe("public plugin-sdk contract", () => {
  it("exports definePlugin and typed context without exporting the host", () => {
    const plugin = pluginSdk.definePlugin({
      manifest: {
        id: "example.public",
        name: "Public example",
        version: "1.0.0",
        apiVersion: "3",
        permissions: ["canvas.read"],
      } as const,
      start(context) {
        expectTypeOf(context.manifest.id).toEqualTypeOf<"example.public">();
      },
    });
    expectTypeOf(plugin.manifest.id).toEqualTypeOf<"example.public">();
    expect(plugin.manifest.apiVersion).toBe("3");
    expect("PluginHost" in pluginSdk).toBe(false);
  });
});
