import { parsePatch } from './diff-model'
import { codeLimits } from './code-highlighting'
import type { DiffRequest, DiffReply } from './diff-loader'

interface Task {
    id: number
    sections: string[]
    index: number
    priority: DiffRequest['priority']
}
const tasks = new Map<number, Task>()
let scheduled = false
function schedule() {
    if (scheduled || !tasks.size) return
    scheduled = true
    setTimeout(step, 0)
}
function step() {
    scheduled = false
    const task = [...tasks.values()].find((item) => item.priority === 'foreground') ?? tasks.values().next().value
    if (!task) return
    const started = performance.now()
    const files: DiffReply['files'] = []
    let failed = false
    do {
        const parsed = parsePatch(task.sections[task.index++])
        if (!parsed.length) {
            failed = true
            break
        }
        files.push(...parsed)
        // Publish the first file immediately; subsequent turns have a small parsing budget.
        if (task.index === 1) break
    } while (task.index < task.sections.length && performance.now() - started < 8)
    const complete = failed || task.index === task.sections.length
    self.postMessage({
        id: task.id,
        files: failed ? [] : files,
        total: task.sections.length,
        complete,
        failed
    } satisfies DiffReply)
    if (complete) tasks.delete(task.id)
    schedule()
}
self.onmessage = (event: MessageEvent<DiffRequest>) => {
    const { id, text, priority, cancel } = event.data
    if (cancel) tasks.delete(id)
    else if (text === undefined) {
        const task = tasks.get(id)
        if (task) task.priority = priority
    } else if (!text.startsWith('diff --git') || text.length > codeLimits.patch) {
        self.postMessage({ id, files: [], total: 0, complete: true } satisfies DiffReply)
    } else {
        tasks.set(id, { id, sections: text.split(/(?=^diff --git )/m).filter(Boolean), index: 0, priority })
    }
    schedule()
}
