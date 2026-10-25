// The service worker that keeps the app playable offline (specification §8, Offline and install). A new version
// waits: the menu offers to reload into it, and a running game is never interrupted.
import { registerSW } from "virtual:pwa-register";
import { gameStore } from "./state/store";

let update: ((reload?: boolean) => Promise<void>) | null = null;

export function registerOffline(): void {
  if (!("serviceWorker" in navigator)) return;
  update = registerSW({ onNeedRefresh: () => gameStore.getState().setUpdateReady() });
}

/** Switches to the waiting version and reloads the page. */
export function applyUpdate(): void {
  void update?.(true);
}
