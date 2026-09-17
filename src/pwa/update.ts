type Listener = (pending: boolean) => void;

const listeners = new Set<Listener>();
let pending = false;
let applyUpdate: (() => Promise<void>) | null = null;

export function pwaUpdatePending(): boolean {
  return pending;
}

export function onPwaUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener(pending);
  return () => { listeners.delete(listener); };
}

export function setPwaUpdateHandler(handler: (() => Promise<void>) | null): void {
  applyUpdate = handler;
}

export function setPwaUpdatePending(next: boolean): void {
  if (pending === next) return;
  pending = next;
  for (const listener of listeners) listener(pending);
}

export async function applyPwaUpdate(): Promise<void> {
  await applyUpdate?.();
}

export function resetPwaUpdateForTests(): void {
  pending = false;
  applyUpdate = null;
  listeners.clear();
}
