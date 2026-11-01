import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { JournalDatabase } from './journal-database'
import { writingRequest } from '../shared/writing'

/** Window ownership and barriers; the worker exclusively owns document commits. */
export class WritingWindows {
    private readonly windows = new Set<BrowserWindow>()
    private readonly clients = new Map<string, number>()
    private readonly pending = new Map<
        string,
        { sender: number; resolve: () => void; reject: (error: Error) => void }
    >()
    private preparing = false
    private exiting = false
    private readonly crashed = new Set<number>()
    allowExit() {
        this.exiting = true
    }
    constructor(store: JournalDatabase, run: <A>(operation: () => Promise<A>) => Promise<A>) {
        const trusted = (event: IpcMainInvokeEvent) => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (!window || !this.windows.has(window) || event.senderFrame !== window.webContents.mainFrame)
                throw new Error('Use a writing window')
            return window
        }
        ipcMain.handle('journal:writing-claim', (event, input: unknown) => {
            trusted(event)
            if (this.preparing) throw new Error('Writing is pausing')
            const client = z.uuid().parse(input)
            if (this.clients.has(client)) return false
            this.clients.set(client, event.sender.id)
            return true
        })
        ipcMain.handle('journal:writing-release', (event, input: unknown) => {
            trusted(event)
            const client = z.uuid().parse(input)
            if (this.clients.get(client) === event.sender.id) this.clients.delete(client)
        })
        ipcMain.handle('journal:writing-open', (event, input: unknown) => {
            trusted(event)
            if (this.preparing) throw new Error('Writing is pausing')
            const request = z
                .object({ draftId: z.string(), generation: z.string(), field: z.enum(['body', 'title']) })
                .parse(input)
            return run(() => store.openWriting(request.draftId, request.field, request.generation))
        })
        ipcMain.handle('journal:writing-submit', (event, input: unknown) => {
            trusted(event)
            const request = writingRequest.parse(input)
            if (this.clients.get(request.client) !== event.sender.id) throw new Error('Writing session expired')
            return run(async () => {
                const next = await store.submitWriting(request)
                for (const window of this.windows)
                    if (!window.isDestroyed()) window.webContents.send('journal:writing-change', next)
                return next
            })
        })
        ipcMain.on('journal:writing-prepared', (event, input: unknown) => {
            const result = z.object({ id: z.string(), error: z.string().optional() }).safeParse(input)
            if (!result.success) return
            const pending = this.pending.get(result.data.id)
            if (!pending || pending.sender !== event.sender.id || event.senderFrame !== event.sender.mainFrame) return
            if (result.data.error) pending.reject(new Error(result.data.error))
            else pending.resolve()
        })
    }
    add(window: BrowserWindow) {
        this.windows.add(window)
        const contentsId = window.webContents.id
        const release = () => {
            for (const [client, owner] of this.clients) if (owner === contentsId) this.clients.delete(client)
        }
        window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
            if (mainFrame) {
                this.crashed.delete(contentsId)
                release()
            }
        })
        window.webContents.on('render-process-gone', () => {
            this.crashed.add(contentsId)
            release()
        })
        let closing = false
        window.on('close', (event) => {
            if (this.exiting || this.crashed.has(contentsId)) return
            event.preventDefault()
            if (closing || this.preparing) return
            closing = true
            void this.prepare([window]).then(
                (resume) => {
                    resume()
                    // Destroying the last window synchronously starts app quit.
                    // Its completed session barrier must no longer look busy.
                    window.destroy()
                },
                (error: unknown) => {
                    closing = false
                    dialog.showErrorBox(
                        'Writing could not be saved',
                        error instanceof Error ? error.message : 'Retry before closing.'
                    )
                }
            )
        })
        window.on('closed', () => {
            this.windows.delete(window)
            release()
        })
    }
    all() {
        return [...this.windows].filter((w) => !w.isDestroyed())
    }
    reset() {
        // Replacement succeeded: release admission without resuming any editor
        // whose generation is now invalid. Reload creates fresh sessions.
        this.preparing = false
        this.clients.clear()
        for (const window of this.all()) window.webContents.reload()
    }
    async prepare(windows = this.all()): Promise<() => void> {
        if (this.preparing) throw new Error('Writing is already pausing')
        this.preparing = true
        const resume = () => {
            this.preparing = false
            for (const window of windows) if (!window.isDestroyed()) window.webContents.send('journal:writing-resume')
        }
        try {
            const results = await Promise.allSettled(
                windows
                    .filter((window) => !this.crashed.has(window.webContents.id))
                    .map(
                        (window) =>
                            new Promise<void>((resolve, reject) => {
                                const id = randomUUID()
                                const timer = setTimeout(() => {
                                    this.pending.delete(id)
                                    reject(new Error('A writing window did not finish saving. Keep it open and retry.'))
                                }, 15000)
                                // Every peer is resumed if any member fails; each timer is cleared.
                                const finish = () => {
                                    clearTimeout(timer)
                                    this.pending.delete(id)
                                }
                                this.pending.set(id, {
                                    sender: window.webContents.id,
                                    resolve: () => {
                                        finish()
                                        resolve()
                                    },
                                    reject: (error) => {
                                        finish()
                                        reject(error)
                                    }
                                })
                                window.webContents.send('journal:writing-prepare', id)
                            })
                    )
            )
            const failure = results.find((result) => result.status === 'rejected')
            if (failure?.status === 'rejected') throw failure.reason
            return resume
        } catch (error) {
            resume()
            throw error
        }
    }
}
