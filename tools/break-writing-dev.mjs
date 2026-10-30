import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const server = await createServer({
    configFile: false,
    root: resolve('src/renderer'),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 4197, strictPort: true },
    clearScreen: false
})
await server.listen()
console.info('Writing stress toggle: http://127.0.0.1:4197/break-writing.html?data=worst')
