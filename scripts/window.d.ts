/** Browser globals used by capture page.evaluate callbacks. */
export {};

declare global {
  interface Window {
    __pd?: { version: number; ready: () => boolean };
    __assetCapture?: {
      catalog: { id: string; variants: number }[];
      inputs: (id: string) => unknown;
    };
  }
}
