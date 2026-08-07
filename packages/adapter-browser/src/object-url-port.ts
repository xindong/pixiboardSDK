import type { ObjectUrlPort } from "./types";

type UrlApi = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};

export class NativeObjectUrlPort implements ObjectUrlPort {
  readonly #url: UrlApi;

  constructor(url: UrlApi = URL) {
    this.#url = url;
  }

  create(blob: Blob): string {
    return this.#url.createObjectURL(blob);
  }

  revoke(url: string): void {
    this.#url.revokeObjectURL(url);
  }
}
