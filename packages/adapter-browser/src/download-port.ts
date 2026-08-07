import type { BrowserDownloadRequest, DownloadPort } from "./types";

export type NativeDownloadPortOptions = {
  document?: Document;
};

export class NativeDownloadPort implements DownloadPort {
  readonly #document: Document;

  constructor(options: NativeDownloadPortOptions = {}) {
    const document = options.document ?? globalThis.document;
    if (document === undefined) throw new Error("Browser download capability is unavailable");
    this.#document = document;
  }

  download(request: BrowserDownloadRequest): void {
    const anchor = this.#document.createElement("a");
    anchor.href = request.url;
    anchor.download = request.fileName;
    anchor.hidden = true;
    this.#document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  }
}
