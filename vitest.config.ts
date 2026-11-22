import { defineConfig } from 'vitest/config'

export default defineConfig({
    // Native SQLite workers and Git subprocesses share the host with Vitest workers.
    test: { include: ['tests/**/*.test.ts'], maxWorkers: 2 }
})
