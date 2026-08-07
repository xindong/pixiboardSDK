import type { BoardDocument } from "@pixi-board/core";
import type { DocumentPersistence } from "pixiboardjs";

/** Narrow desktop contract; a board receives a lease, never the shared store. */
export type DesktopDocumentPort = DocumentPersistence;

export type DesktopDocumentLease = DesktopDocumentPort & {
  readonly ownerId: string;
  readonly released: boolean;
};

/** Fake Tauri bridge with explicit per-board ownership. */
export class MemoryTauriDocumentPort {
  readonly #documents = new Map<string, BoardDocument>();
  readonly #leases = new Map<string, MemoryTauriDocumentLeaseImpl>();
  readonly saves: Array<{ boardId: string; revision: number }> = [];

  get activeOwners(): readonly string[] { return [...this.#leases.keys()]; }
  get closed(): boolean { return this.#leases.size === 0; }

  acquire(ownerId: string): DesktopDocumentLease {
    if (!ownerId || this.#leases.has(ownerId)) throw new Error(`Persistence lease already owned: ${ownerId}`);
    const lease = new MemoryTauriDocumentLeaseImpl(this, ownerId);
    this.#leases.set(ownerId, lease);
    return lease;
  }

  async load(ownerId: string, signal?: AbortSignal): Promise<BoardDocument | undefined> {
    this.assertLease(ownerId, signal);
    const snapshot = this.#documents.get(ownerId);
    return snapshot === undefined ? undefined : structuredClone(snapshot);
  }

  async save(ownerId: string, document: BoardDocument, signal?: AbortSignal): Promise<void> {
    this.assertLease(ownerId, signal);
    this.#documents.set(ownerId, structuredClone(document));
    this.saves.push({ boardId: ownerId, revision: document.revision });
  }

  release(ownerId: string): void {
    const lease = this.#leases.get(ownerId);
    if (!lease) return;
    lease.released = true;
    this.#leases.delete(ownerId);
  }

  private assertLease(ownerId: string, signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (!this.#leases.has(ownerId)) throw new Error(`Persistence lease is not active: ${ownerId}`);
  }
}

class MemoryTauriDocumentLeaseImpl implements DesktopDocumentLease {
  released = false;
  constructor(private readonly owner: MemoryTauriDocumentPort, readonly ownerId: string) {}

  load(options: { signal?: AbortSignal } = {}): Promise<BoardDocument | null> {
    return this.owner.load(this.ownerId, options.signal).then((snapshot) => snapshot ?? null);
  }

  save(document: BoardDocument, options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.owner.save(this.ownerId, document, options.signal);
  }

  destroy(): void { this.owner.release(this.ownerId); }
}
