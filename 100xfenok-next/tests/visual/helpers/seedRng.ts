import type { BrowserContext } from "@playwright/test";

export async function seedRng(context: BrowserContext, seed = 123456789): Promise<void> {
  await context.addInitScript((seedValue: number) => {
    let state = seedValue >>> 0;
    const next = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };

    Math.random = next;
    (window as unknown as { __VRT_SEED__: number }).__VRT_SEED__ = seedValue;
  }, seed);
}
