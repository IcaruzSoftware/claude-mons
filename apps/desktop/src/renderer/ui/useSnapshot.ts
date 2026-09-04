import { signal } from '@preact/signals';
import type { UiSnapshot } from '../../common/ipc.ts';

/** Live snapshot pushed by the main process; null until the first response arrives. */
export const snapshot = signal<UiSnapshot | null>(null);

let started = false;
export function startSnapshotFeed(): void {
  if (started) return;
  started = true;
  void window.monsUi.getSnapshot().then((s) => (snapshot.value = s));
  window.monsUi.onSnapshot((s) => (snapshot.value = s));
}
