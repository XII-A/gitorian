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
    test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 }
})
