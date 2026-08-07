export type SelectionChangeEvent = {
  nodeIds: string[];
  previousNodeIds: string[];
};

export class SelectionController {
  private selected = new Set<string>();
  private readonly listeners = new Set<(event: SelectionChangeEvent) => void>();

  constructor(
    private readonly nodeExists: (id: string) => boolean,
    private readonly beforeMutation: () => void = () => {},
  ) {}

  get(): string[] {
    return [...this.selected];
  }

  set(nodeIds: Iterable<string>): void {
    this.beforeMutation();
    const next = new Set<string>();
    for (const id of nodeIds) {
      if (this.nodeExists(id)) next.add(id);
    }
    this.commit(next);
  }

  toggle(nodeId: string): void {
    this.beforeMutation();
    if (!this.nodeExists(nodeId)) return;
    const next = new Set(this.selected);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    this.commit(next);
  }

  clear(): void {
    this.beforeMutation();
    this.commit(new Set());
  }

  onChange(listener: (event: SelectionChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  prune(): boolean {
    const next = new Set([...this.selected].filter((id) => this.nodeExists(id)));
    return this.commit(next);
  }

  private commit(next: Set<string>): boolean {
    const previous = [...this.selected];
    const current = [...next];
    if (sameIds(previous, current)) return false;
    this.selected = next;
    const event = { nodeIds: [...current], previousNodeIds: [...previous] };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Session listeners cannot roll back or corrupt selection state.
      }
    }
    return true;
  }
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
