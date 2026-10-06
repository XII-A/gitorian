import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    main: { build: { externalizeDeps: true } },
    preload: {
        build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
    },
    renderer: { plugins: [react()] }
})
