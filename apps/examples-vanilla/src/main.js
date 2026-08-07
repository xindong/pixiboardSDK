import "./styles.css";

// This import is intentionally the public consumer path. The current
// planning worktree has no dist artifacts yet; the fixture is exercised after
// a packed pixiboardjs artifact is installed in a clean copy.
import * as PixiBoardJS from "pixiboardjs";

const status = document.querySelector("#status");
const boardHost = document.querySelector("#board");

if (new URLSearchParams(window.location.search).has("browser-contract")) {
  const { browserContracts } = await import("./browser-contract.js");
  window.pixiBoardBrowserContracts = browserContracts;
}

status.textContent = `Loaded pixiboardjs exports: ${Object.keys(PixiBoardJS).join(", ") || "(placeholder)"}`;
boardHost.dataset.consumer = "pixiboardjs";
