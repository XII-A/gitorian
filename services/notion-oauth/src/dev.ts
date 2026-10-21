import { createServer } from 'node:http'
import { createOAuthHandler, oauthConfig } from './handler'

const port = Number(process.env.NOTION_OAUTH_PORT ?? 8788)
const origin = process.env.NOTION_OAUTH_ORIGIN ?? `http://127.0.0.1:${port}`
let handler: ReturnType<typeof createOAuthHandler> | undefined
try {
    handler = createOAuthHandler(oauthConfig({ ...process.env, NOTION_OAUTH_ORIGIN: origin }))
} catch {
    console.info(
        'Notion development OAuth is unconfigured. Copy services/notion-oauth/.env.example to .env.local and configure a development Notion connection.'
    )
}
const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of incoming) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
            size += bytes.length
            if (size > 8192) {
                outgoing.writeHead(413).end()
                return
            }
            chunks.push(bytes)
        }
        const request = new Request(new URL(incoming.url ?? '/', origin), {
            method: incoming.method,
            headers: incoming.headers as Record<string, string>,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {})
        })
        const response = handler
            ? await handler(request)
            : Response.json(
                  { message: 'Configure services/notion-oauth/.env.local to connect Notion in development.' },
                  { status: 503 }
              )
        outgoing.writeHead(response.status, Object.fromEntries(response.headers))
        outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
        outgoing.writeHead(500).end('OAuth request failed.')
    }
})
server.listen(port, '127.0.0.1', () => console.info(`Notion OAuth listening at ${origin} (PID ${process.pid})`))
server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
})
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close())
