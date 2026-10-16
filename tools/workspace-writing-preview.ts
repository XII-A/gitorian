import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { workspace } from '../tests/fixtures'
import { sampleState } from '../src/renderer/workspace-sample'
import { commandSchema, weekOf } from '../src/shared/model'

// Isolated profiling fixture. It never connects to real providers or a user's store.
const fixture = await workspace()
const week = weekOf(new Date(), fixture.store.state.settings)
const sample = sampleState(week)
fixture.store.state.repositories = sample.repositories
fixture.store.state.activities = Array.from({ length: 600 }, (_, index) => ({
    ...structuredClone(sample.activities[index % sample.activities.length]),
    id: `writing-qa-${index}`
}))
fixture.store.state.settings.template = sample.drafts[0].body
await fixture.service.handle({ type: 'newDraft', week })
fixture.store.state.drafts[0].body = {
    type: 'doc',
    content: Array.from({ length: 200 }, (_, index) => ({
        type: 'paragraph',
        content: [
            {
                type: 'text',
                text: `Paragraph ${index}. Keep writing responsive while saving locally and acquiring activity in the background. Each paragraph must keep its words and boundaries.`
            }
        ]
    }))
}
fixture.store.persist()
let background = false
const timer = setInterval(() => {
    if (!background) return
    fixture.store.state.activities[0].description = `Background update ${Date.now()}`
    fixture.store.persist()
}, 2000)
const root = resolve('out/renderer')
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url ?? '/', 'http://localhost:4181').pathname
        if (path === '/background') {
            background = !background
            fixture.store.state.acquisition = background ? { 'git:sample-repo-0': { status: 'running' } } : {}
            fixture.store.persist()
            response.end(JSON.stringify({ background }))
            return
        }
        if (path === '/rpc') {
            let body = ''
            for await (const chunk of request) body += String(chunk)
            const command = commandSchema.parse(JSON.parse(body))
            const reply = ['open', 'popout'].includes(command.type)
                ? fixture.service.reply()
                : await fixture.service.handle(command)
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify(reply))
            return
        }
        if (path === '/bridge.js') {
            response.setHeader('Content-Type', 'application/javascript')
            response.end(
                `window.__writingQa={commands:[],frames:[],longTasks:[]};new PerformanceObserver(list=>window.__writingQa.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});window.journal={invoke:async command=>{const start=performance.now();const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const value=await r.json();window.__writingQa.commands.push({type:command.type,start,end:performance.now()});if(!r.ok)throw new Error(value.error);return value}};`
            )
            return
        }
        const file = resolve(root, path === '/' ? 'index.html' : `.${path}`)
        if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) throw new Error('Invalid fixture path')
        let content = await readFile(file)
        if (path === '/')
            content = Buffer.from(content.toString().replace('<head>', '<head><script src="/bridge.js"></script>'))
        response.setHeader(
            'Content-Type',
            extname(file) === '.js' ? 'application/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'
        )
        response.end(content)
    } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: String(error) }))
    }
})
server.listen(4181, '127.0.0.1', () => console.info(`Writing QA: http://localhost:4181/?workspace=true&week=${week}`))
process.on('SIGINT', () => {
    clearInterval(timer)
    server.close()
    void fixture.close().then(() => process.exit(0))
})
