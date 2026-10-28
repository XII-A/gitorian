import { defineConfig } from 'vitest/config'

export default defineConfig({
    // Integration tests combine a DOM renderer with the real main-process store.
    // Keep Node's SQLite implementation native in the DOM environment too.
    plugins: [
        {
            name: 'native-test-sqlite',
            enforce: 'pre',
            resolveId(id) {
                if (id === 'node:sqlite') return { id, external: true }
            }
        }
    ],
    // Domain scenarios own native database workers; bound simultaneous profiles and Git processes.
    // Threads retain per-file isolation without spawning a process for every test file.
    test: { include: ['tests/**/*.test.ts'], pool: 'threads', maxWorkers: 4, testTimeout: 20000 }
})
