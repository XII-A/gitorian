import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync } from 'node:fs'

export default defineConfig({
    main: {
        plugins: [
            {
                name: 'recovery-native-adapter',
                closeBundle() {
                    copyFileSync('src/main/recovery-terminate.ps1', 'out/main/recovery-terminate.ps1')
                }
            }
        ],
        build: {
            externalizeDeps: true,
            rollupOptions: {
                output: { chunkFileNames: '[name]-[hash].js' },
                input: {
                    index: resolve('src/main/index.ts'),
                    'database-worker': resolve('src/main/database-worker.ts'),
                    'recovery-watchdog': resolve('src/main/recovery-watchdog.ts')
                }
            }
        }
    },
    preload: {
        build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
    },
    renderer: { plugins: [react()] }
})
