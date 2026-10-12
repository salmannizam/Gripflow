/** Error-isolating typed event emitter. A throwing listener never breaks the drag operation. */
export type Listener<P> = (payload: P) => void;

export interface EmitterErrorInfo {
  readonly event: string;
  readonly error: unknown;
}

export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(private readonly onError: (info: EmitterErrorInfo) => void) {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set.delete(listener as Listener<never>);
    };
  }

  has<K extends keyof Events>(event: K): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  /** Calls every listener, isolating failures. Returns the errors that were thrown. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): unknown[] {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return [];
    const errors: unknown[] = [];
    for (const l of [...set]) {
      try {
        (l as Listener<Events[K]>)(payload);
      } catch (error) {
        errors.push(error);
        this.onError({ event: String(event), error });
      }
    }
    return errors;
  }

  clear(): void {
    this.listeners.clear();
  }
}
