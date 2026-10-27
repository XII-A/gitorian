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
    test: { include: ['tests/**/*.test.ts'], maxWorkers: 4, testTimeout: 20000 }
})
