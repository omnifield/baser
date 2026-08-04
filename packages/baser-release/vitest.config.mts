import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/baser-release',
  test: {
    name: '@omnifield/baser-release',
    watch: false,
    globals: true,
    environment: 'node',
    // Пробы лежат рядом с кодом (`lib`) и отдельно для прогонов на живом
    // репозитории (`tests`). Расширение — `.mjs`, потому что инструмент не
    // собирается: пробуется тот самый файл, который запускает CI.
    include: ['{lib,tests}/**/*.{test,spec}.mjs'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
