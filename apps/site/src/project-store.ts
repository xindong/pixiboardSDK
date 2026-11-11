import type { BoardDocument } from "@pixi-board/core";

export type SiteProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  document: BoardDocument;
};

export type SiteRecovery = { temporary: boolean };

const DB_NAME = "pixiboard-site-projects";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const META_STORE = "meta";
const ACTIVE_PROJECT_KEY = "active-project-id";

export class SiteProjectStore {
  #database: Promise<IDBDatabase> | undefined;
  #temporary: SiteProject | undefined;
  /** Set when the active canvas could not be opened and a recovery board was used. */
  recovery: SiteRecovery | undefined;

  async list(): Promise<Array<Omit<SiteProject, "document">>> {
    if (this.#temporary) {
      const { document: _document, ...project } = this.#temporary;
      return [project];
    }
    const database = await this.database();
    const projects = await request<Array<SiteProject>>(database.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).getAll());
    return projects
      .map(({ document: _document, ...project }) => project)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async all(): Promise<SiteProject[]> {
    if (this.#temporary) return [this.#temporary];
    const database = await this.database();
    const projects = await request<SiteProject[]>(database.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).getAll());
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async loadActive(fallback: () => BoardDocument): Promise<SiteProject> {
    try {
      const activeId = await this.activeId();
      if (activeId) {
        const active = await this.get(activeId);
        if (active) return active;
      }
      const [latest] = await this.list();
      if (latest) {
        await this.setActive(latest.id);
        const project = await this.get(latest.id);
        if (project) return project;
      }
      return await this.create("画布", fallback());
    } catch (error) {
      return this.recover(fallback, error);
    }
  }

  async get(id: string): Promise<SiteProject | undefined> {
    if (this.#temporary) return this.#temporary.id === id ? this.#temporary : undefined;
    const database = await this.database();
    return request<SiteProject | undefined>(database.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).get(id));
  }

  async create(name: string, document: BoardDocument): Promise<SiteProject> {
    if (this.#temporary) {
      this.#temporary = { ...this.#temporary, name, document, updatedAt: Date.now() };
      return this.#temporary;
    }
    const now = Date.now();
    const project: SiteProject = {
      id: `site-project-${crypto.randomUUID()}`,
      name,
      createdAt: now,
      updatedAt: now,
      document,
    };
    const database = await this.database();
    await transactionDone(database.transaction(PROJECT_STORE, "readwrite"), (transaction) => {
      transaction.objectStore(PROJECT_STORE).put(project);
    });
    await this.setActive(project.id);
    return project;
  }

  async save(id: string, document: BoardDocument): Promise<void> {
    if (this.#temporary) {
      if (this.#temporary.id === id) this.#temporary = { ...this.#temporary, document, updatedAt: Date.now() };
      return;
    }
    const current = await this.get(id);
    if (!current) return;
    const database = await this.database();
    await transactionDone(database.transaction(PROJECT_STORE, "readwrite"), (transaction) => {
      transaction.objectStore(PROJECT_STORE).put({ ...current, updatedAt: Date.now(), document });
    });
  }

  async rename(id: string, name: string): Promise<SiteProject | undefined> {
    if (this.#temporary) {
      if (this.#temporary.id !== id) return undefined;
      this.#temporary = { ...this.#temporary, name, updatedAt: Date.now() };
      return this.#temporary;
    }
    const current = await this.get(id);
    if (!current) return undefined;
    const next = { ...current, name, updatedAt: Date.now() };
    const database = await this.database();
    await transactionDone(database.transaction(PROJECT_STORE, "readwrite"), (transaction) => {
      transaction.objectStore(PROJECT_STORE).put(next);
    });
    return next;
  }

  async delete(id: string, preserveActive = false): Promise<void> {
    if (this.#temporary) return;
    const database = await this.database();
    await transactionDone(database.transaction([PROJECT_STORE, META_STORE], "readwrite"), (transaction) => {
      transaction.objectStore(PROJECT_STORE).delete(id);
      if (!preserveActive) transaction.objectStore(META_STORE).delete(ACTIVE_PROJECT_KEY);
    });
  }

  async setActive(id: string): Promise<void> {
    if (this.#temporary) return;
    const database = await this.database();
    await transactionDone(database.transaction(META_STORE, "readwrite"), (transaction) => {
      transaction.objectStore(META_STORE).put(id, ACTIVE_PROJECT_KEY);
    });
  }

  async clear(): Promise<void> {
    if (this.#temporary) return;
    const database = await this.database();
    await transactionDone(database.transaction([PROJECT_STORE, META_STORE], "readwrite"), (transaction) => {
      transaction.objectStore(PROJECT_STORE).clear();
      transaction.objectStore(META_STORE).clear();
    });
  }

  private async activeId(): Promise<string | undefined> {
    if (this.#temporary) return this.#temporary.id;
    const database = await this.database();
    return request<string | undefined>(database.transaction(META_STORE, "readonly").objectStore(META_STORE).get(ACTIVE_PROJECT_KEY));
  }

  /**
   * Open a fresh recovery canvas when the stored one cannot be read or the
   * renderer rejects it. Existing records are preserved; if browser storage
   * itself is unavailable, keep an in-memory temporary canvas so export works.
   */
  async recover(fallback: () => BoardDocument, error?: unknown): Promise<SiteProject> {
    console.warn("Opening a recovery canvas", error);
    const document = fallback();
    try {
      const project = await this.create("恢复画布", document);
      this.recovery = { temporary: false };
      return project;
    } catch (recoveryError) {
      console.warn("Persistent recovery unavailable", recoveryError);
      const now = Date.now();
      this.#temporary = { id: "temporary-" + crypto.randomUUID(), name: "临时画布", createdAt: now, updatedAt: now, document };
      this.recovery = { temporary: true };
      return this.#temporary;
    }
  }

  private database(): Promise<IDBDatabase> {
    this.#database ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains(PROJECT_STORE)) database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("Failed to open site project store"));
      open.onblocked = () => reject(new Error("Site project store upgrade was blocked"));
    });
    return this.#database;
  }
}

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction, work: (transaction: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    work(transaction);
  });
}
