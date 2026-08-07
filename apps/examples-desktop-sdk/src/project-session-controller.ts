import { TauriAdapterHost, type AcquireProjectOptions, type TauriProjectLease } from "@pixi-board/adapter-tauri";
import type { PixiBoardOptions } from "pixiboardjs";
import { createDesktopBoard, type DesktopBoardHost } from "./index";

export type DesktopProjectSession = {
  readonly project: AcquireProjectOptions;
  readonly lease: TauriProjectLease;
  readonly host: DesktopBoardHost;
};

export type DesktopProjectSessionControllerOptions = {
  readonly tauri: TauriAdapterHost;
  readonly board: Omit<PixiBoardOptions, "persistence">;
};

/** Owns project switching; the SDK facade remains the only document write path. */
export class DesktopProjectSessionController {
  #current?: DesktopProjectSession;
  #switchPromise?: Promise<DesktopProjectSession>;

  constructor(private readonly options: DesktopProjectSessionControllerOptions) {}

  get current(): DesktopProjectSession | undefined { return this.#current; }

  async open(project: AcquireProjectOptions): Promise<DesktopProjectSession> {
    if (this.#switchPromise) return this.#switchPromise;
    this.#switchPromise = this.#open(project).finally(() => { this.#switchPromise = undefined; });
    return this.#switchPromise;
  }

  async switchProject(project: AcquireProjectOptions): Promise<DesktopProjectSession> {
    return this.open(project);
  }

  async destroy(): Promise<void> {
    const current = this.#current;
    this.#current = undefined;
    if (current) await current.host.destroy();
    await this.options.tauri.destroy();
  }

  async #open(project: AcquireProjectOptions): Promise<DesktopProjectSession> {
    const previous = this.#current;
    this.#current = undefined;
    if (previous) await previous.host.destroy();
    const lease = await this.options.tauri.acquire(project);
    try {
      const host = await createDesktopBoard({ ...this.options.board, boardId: project.boardId, persistence: lease.document });
      const next = { project, lease, host };
      this.#current = next;
      return next;
    } catch (error) {
      await lease.destroy().catch(() => undefined);
      throw error;
    }
  }
}
