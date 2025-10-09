/**
 * Vitest 전역 설정
 */

// Mock crypto.randomUUID for Node.js < 19
if (!globalThis.crypto) {
  globalThis.crypto = {
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
  };
}

// Mock console methods for cleaner test output
globalThis.console = {
  ...console,
  log: () => {}, // Suppress logs during tests
  warn: () => {},
  error: console.error // Keep errors visible
};
