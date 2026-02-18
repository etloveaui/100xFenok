import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'jsdom',

    // Global test setup
    globals: true,
    setupFiles: ['./tests/setup.js'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.js',
        'dist/',
        'data/'
      ],
      all: true,
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80
    },

    // Test matching patterns
    include: ['tests/**/*.{test,spec}.js'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],

    // Test timeout
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporter configuration
    reporter: ['verbose', 'html'],
    outputFile: {
      html: './test-results/index.html'
    },

    // Parallel execution
    threads: true,
    maxThreads: 4,

    // Mock configuration
    mockReset: true,
    restoreMocks: true,
    clearMocks: true
  }
});
