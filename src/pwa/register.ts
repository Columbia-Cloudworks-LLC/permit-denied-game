import { registerSW } from 'virtual:pwa-register';
import { setPwaUpdateHandler, setPwaUpdatePending } from './update';

/** Register the game service worker in production builds only. */
export function registerGamePwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      setPwaUpdatePending(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
  setPwaUpdateHandler(() => apply());
}
