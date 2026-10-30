import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { run } from '../tests/effect-fixtures'
import { seedJournal } from '../tests/database-fixtures'
import { workspace } from '../tests/fixtures'
import { sampleState } from '../tests/workspace-fixture'
import { commandSchema, weekOf } from '../src/shared/model'

// Isolated profiling fixture. It never connects to real providers or a user's store.
const fixture = await workspace()
const week = weekOf(new Date(), fixture.store.config.settings)
const sample = sampleState(week)
sample.diffs = {}
sample.activities = Array.from({ length: 600 }, (_, index) => ({
    ...structuredClone(sample.activities[index % sample.activities.length]),
    id: `writing-qa-${index}`
}))
sample.settings.template = sample.drafts[0].body
sample.drafts[0].body = {
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
await seedJournal(fixture.store, sample)
let background = false
const timer = setInterval(async () => {
    if (!background) return
    const activity = (await fixture.store.activities())[0]
    activity.description = `Background update ${Date.now()}`
    await fixture.store.applyAcquisitionBatch({ activities: [activity] })
}, 2000)
const root = resolve('out/renderer')
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url ?? '/', 'http://localhost:4181').pathname
        if (path === '/background') {
            background = !background
            await fixture.store.saveCheckpoint('git:sample-repo-0', { status: background ? 'running' : 'idle' })
            response.end(JSON.stringify({ background }))
            return
        }
        if (path === '/rpc') {
            let body = ''
            for await (const chunk of request) body += String(chunk)
            const command = commandSchema.parse(JSON.parse(body))
            const reply = ['open', 'popout'].includes(command.type)
                ? await run(fixture.service.reply())
                : await run(fixture.service.handle(command))
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
