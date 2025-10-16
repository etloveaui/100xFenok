/**
 * Vitest Global Test Setup
 * Runs before all tests
 */

import { vi } from 'vitest';

// Mock fetch API for all tests
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
global.localStorage = localStorageMock;

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn() // Keep error for debugging
};

// Setup DOM environment
beforeEach(() => {
  // Reset DOM
  document.body.innerHTML = '';

  // Reset mocks
  vi.clearAllMocks();
});

afterEach(() => {
  // Cleanup
  vi.restoreAllMocks();
});
