import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";
import * as sdk from "../src/index";
import * as browser from "../src/browser";

describe("external consumer contract", () => {
  it("keeps the root facade small and does not expose mutable runtime internals", () => {
    expect(sdk.createPixiBoard).toBeTypeOf("function");
    expect("BoardCore" in sdk).toBe(false);
    expect("BoardStore" in sdk).toBe(false);
    expect("PixiBoardRenderer" in sdk).toBe(false);
    expect("PixiApplication" in sdk).toBe(false);
  });

  it("publishes browser ports from the explicit browser entry", () => {
    expect(browser.indexedDbPersistence).toBeTypeOf("function");
    expect(browser.BrowserPersistenceAdapter).toBeTypeOf("function");
    expect(browser.NativeIndexedDbPort).toBeTypeOf("function");
  });

  it("resolves every public subpath to publishable artifacts", () => {
    expect(packageJson.exports["."].import).toBe("./dist/index.js");
    expect(packageJson.exports["./browser"].import).toBe("./dist/browser.js");
    expect(packageJson.exports["./node"].import).toBe("./dist/node.js");
    expect(packageJson.exports["./types"].import).toBe("./dist/types.js");
    expect(packageJson.exports["."].types).toBe("./dist/index.d.ts");
  });

  it("keeps public custom-node declarations independent from the private renderer package", () => {
    const publicTypes = readFileSync(fileURLToPath(new URL("../src/types.ts", import.meta.url)), "utf8");
    expect(publicTypes).not.toContain("@pixi-board/renderer-pixi");
    expect(publicTypes).toContain("export type CustomNodeDefinition");
    expect(publicTypes).toContain("export type CustomNodeRendererContext");
  });
});
