import { describe, expect, it } from "vitest";
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

  it("resolves every public subpath to an implemented source entry", () => {
    expect(packageJson.exports["."].import).toBe("./src/index.ts");
    expect(packageJson.exports["./browser"].import).toBe("./src/browser.ts");
    expect(packageJson.exports["./node"].import).toBe("./src/node.ts");
    expect(packageJson.exports["./types"].import).toBe("./src/types.ts");
  });
});
