import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
    main: {
        build: {
            externalizeDeps: true,
            rollupOptions: {
                input: {
                    index: resolve('src/main/index.ts'),
                    'database-worker': resolve('src/main/database-worker.ts')
                }
            }
        }
    },
    preload: {
        build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
    },
    renderer: { plugins: [react()] }
})
