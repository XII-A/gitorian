import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
    main: { build: { externalizeDeps: true } },
    preload: {
        build: { externalizeDeps: true, rollupOptions: { output: { entryFileNames: 'index.cjs', format: 'cjs' } } }
    },
    renderer: { plugins: [react()] }
})
