import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ReplyUpdates } from '../shared/state-updates'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { Effect } from 'effect'
import { commandSchema } from '../shared/model'
import type { RepositoryImportProgress } from '../shared/model'
import { Store } from './store'
import { Vault } from './vault'
import { Http } from './http'
import { GitHub } from './github'
import { Notion } from './notion'
import { JournalService } from './service'
import { inspectRepository } from './git'

const directory = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow
let store: Store
let service: JournalService
const referenceWindows = new Set<number>()
const work = new Set<Promise<unknown>>()
function track<T>(promise: Promise<T>): Promise<T> {
    work.add(promise)
    void promise
        .finally(() => work.delete(promise))
        .catch(() => {
            // The command caller or background task owns its error presentation.
        })
    return promise
}
function windowFor(reference?: { kind: string; id: string }): BrowserWindow {
    const window = new BrowserWindow({
        title: 'weekly-j',
        width: reference ? 1400 : 1560,
        height: 1000,
        minWidth: reference ? 600 : 1000,
        minHeight: 640,
        backgroundColor: '#151715',
        show: false,
        webPreferences: {
            preload: join(directory, '../preload/index.cjs'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
        }
    })
    const contentsId = window.webContents.id
    if (reference) referenceWindows.add(contentsId)
    window.on('closed', () => {
        referenceWindows.delete(contentsId)
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
        void openExternal(url)
        return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event) => {
        event.preventDefault()
    })
    window.once('ready-to-show', () => {
        window.show()
    })
    const query = reference ? `?reference=${reference.kind}&id=${encodeURIComponent(reference.id)}` : ''
    if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
    else void window.loadFile(join(directory, '../renderer/index.html'), { search: query })
    return window
}
async function openExternal(value: string): Promise<void> {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Only web links can be opened')
    await shell.openExternal(url.toString())
}
async function folder(): Promise<string | undefined> {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
}
void app.whenReady().then(() => {
    store = new Store(join(app.getPath('userData'), 'weekly-j.sqlite'))
    store.enableBackgroundWrites()
    const vault = new Vault(app.getPath('userData'))
    store.state.transportPauses ??= {}
    const http = new Http(fetch, { pauses: store.state.transportPauses, changed: () => store.persist() })
    const github = new GitHub(
        http,
        () => vault.get('github'),
        (token) => {
            vault.set('github', token)
        }
    )
    const notion = new Notion(http, () => vault.get('notion'))
    service = new JournalService(store, github, notion, () => ({
        github: !!vault.get('github'),
        notion: !!vault.get('notion'),
        protectedStorage: vault.protected()
    }))
    mainWindow = windowFor()
    const commandHandler = async (event: IpcMainInvokeEvent, input: unknown) => {
        const command = commandSchema.parse(input)
        const trusted = BrowserWindow.fromWebContents(event.sender)
        if (!trusted) throw new Error('Unknown desktop window')
        if (referenceWindows.has(event.sender.id) && !['state', 'details', 'open'].includes(command.type))
            throw new Error('Reference windows are read-only')
        switch (command.type) {
            case 'refresh':
                void track(service.refresh({ ...command, resume: true }))
                return service.reply({ message: 'Activity refresh started. You can keep writing.' })
            case 'backfill': {
                const repository = store.state.repositories.find((item) => item.id === command.repositoryId)
                if (!repository || repository.removed) throw new Error('Choose a tracked repository.')
                if (command.since > repository.trackingStart)
                    throw new Error('Choose a date before the current history start.')
                void track(
                    service.backfill(command.repositoryId, command.since).catch((error: unknown) => {
                        store.state.refreshError = error instanceof Error ? error.message : String(error)
                        store.persist()
                    })
                )
                return service.reply({ message: 'Older activity is being acquired in the background.' })
            }
            case 'details':
                try {
                    return await service.handle(command)
                } catch (error) {
                    return service.reply({ detailError: error instanceof Error ? error.message : String(error) })
                }
            case 'addRepository': {
                const path = await folder()
                if (path) await service.addRepository(path)
                break
            }
            case 'addRepositories': {
                let lastStage = ''
                let lastSent = 0
                const progress = (update: RepositoryImportProgress) => {
                    const finished = update.stage === 'processing' && update.completed === update.total
                    if (update.stage !== lastStage || finished || Date.now() - lastSent >= 50) {
                        lastStage = update.stage
                        lastSent = Date.now()
                        if (!event.sender.isDestroyed() && !event.sender.isLoadingMainFrame())
                            event.sender.send('journal:repository-import', update)
                    }
                }
                progress({ stage: 'selecting' })
                const path = await folder()
                if (!path) return service.reply()
                if (store.state.repositoryImport?.status === 'running')
                    return service.reply({ message: 'A repository import is already running.' })
                store.state.repositoryImport = { status: 'running', completed: 0, total: 0 }
                store.persist()
                void track(
                    service.addRepositories(path, progress).then(() => {
                        if (store.state.settings.refreshMinutes > 0) void track(service.refresh({ afterCurrent: true }))
                    })
                ).catch((error: unknown) => {
                    store.state.repositoryImport = {
                        id: store.state.repositoryImport?.id,
                        status: 'error',
                        completed: 0,
                        total: 0,
                        message: error instanceof Error ? error.message : String(error)
                    }
                    store.persist()
                })
                return service.reply({ message: 'Import started. You can close Settings and keep writing.' })
            }
            case 'relocate': {
                const path = await folder()
                if (path) {
                    const inspected = await inspectRepository(path)
                    const repository = store.state.repositories.find((item) => item.id === command.id)
                    if (!repository) throw new Error('Repository not found')
                    repository.path = inspected.path
                    repository.branches = inspected.branches
                    repository.remotes = inspected.remotes
                    repository.available = true
                    repository.removed = false
                    store.persist()
                }
                break
            }
            case 'notionConnect':
                await new Notion(http, () => command.token).verify()
                vault.set('notion', command.token)
                break
            case 'notionTestDestination':
                await notion.verifyDestination(command.destination)
                return service.reply({ message: 'Destination is reachable.' })
            case 'notionProfile':
                return service.reply({ notionIdentity: await notion.profile() })
            case 'githubStart': {
                const device = await github.start(store.state.settings.githubClientId)
                try {
                    await openExternal(device.url)
                } catch {
                    return service.reply({
                        device,
                        message: 'Could not open your browser. Use Open browser or visit the displayed address.'
                    })
                }
                return service.reply({ device })
            }
            case 'githubPoll': {
                const account = await github.poll()
                if ('pending' in account) return service.reply({ devicePending: { interval: account.interval } })
                store.state.settings.githubLogin = account.login
                for (const repository of store.state.repositories)
                    repository.emails = [...new Set([...repository.emails, ...account.emails])]
                store.persist()
                break
            }
            case 'disconnect':
                vault.set(command.service, '')
                break
            case 'export': {
                const result = await dialog.showSaveDialog(mainWindow, {
                    defaultPath: 'weekly-j-backup.json',
                    filters: [{ name: 'Tracking backup', extensions: ['json'] }]
                })
                if (result.filePath) await writeFile(result.filePath, store.export(), 'utf8')
                break
            }
            case 'import': {
                const result = await dialog.showOpenDialog(mainWindow, {
                    properties: ['openFile'],
                    filters: [{ name: 'Tracking backup', extensions: ['json'] }]
                })
                if (!result.canceled) {
                    const confirmation = await dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        buttons: ['Cancel', 'Replace local tracking'],
                        defaultId: 0,
                        cancelId: 0,
                        message: 'Replace local tracking and drafts with this backup?',
                        detail: 'Export your current data first if you need to keep it.'
                    })
                    if (confirmation.response === 1) {
                        store.restore(await readFile(result.filePaths[0], 'utf8'))
                        await store.flush()
                        vault.set('github', '')
                        vault.set('notion', '')
                        return service.reply({ message: 'Backup imported.' })
                    }
                }
                break
            }
            case 'open':
                await openExternal(command.url)
                break
            case 'popout':
                windowFor(command)
                break
            case 'state': {
                const remotes: Record<string, string[]> = {}
                for (const repository of store.state.repositories) remotes[repository.id] = repository.remotes ?? []
                return { ...service.reply(), remotes }
            }
            default:
                return Effect.runPromise(service.execute(command))
        }
        return service.reply()
    }
    const durableCommand: typeof commandHandler = async (event, input) => {
        if (closing) throw new Error('Journal is closing; retry after reopening the app')
        return track(
            (async () => {
                const reply = await commandHandler(event, input)
                await store.flush()
                return reply
            })()
        )
    }
    ipcMain.handle('journal:command', durableCommand)
    const updates = new ReplyUpdates()
    const updateRequest = z.object({
        command: commandSchema,
        base: z.object({ snapshotVersion: z.number().int().nonnegative(), restoreId: z.string().optional() }).optional()
    })
    ipcMain.handle('journal:updates', async (event, input: unknown) => {
        const request = updateRequest.parse(input)
        return updates.pack(await durableCommand(event, request.command), request.base)
    })
    const refreshIfActive = () => {
        if (closing) return
        const minutes = store.state.settings.refreshMinutes
        const elapsed =
            Date.now() - new Date(store.state.lastRefreshAttempt ?? store.state.lastRefreshed ?? 0).getTime()
        const pending = Object.entries(store.state.acquisition ?? {}).find(
            ([key, status]) =>
                store.state.repositories.some(
                    (repository) => key.endsWith(`:${repository.id}`) && !repository.removed
                ) &&
                (!key.startsWith('github:') || !!vault.get('github')) &&
                (key.startsWith('github:') || key.startsWith('git:')) &&
                status.windowEnd &&
                (status.status === 'idle' ||
                    (status.status === 'paused' && !!status.retryAt && Date.parse(status.retryAt) <= Date.now()))
        )
        if (pending) {
            const [source, repositoryId] = pending[0].split(':')
            void track(service.refresh({ repositoryId, source: source === 'git' ? 'git' : 'github' }))
            return
        }
        if (minutes > 0 && !mainWindow.isDestroyed() && mainWindow.isVisible() && elapsed >= minutes * 60000)
            void track(service.refresh())
    }
    setInterval(refreshIfActive, 5000).unref()
    if (store.state.settings.refreshMinutes > 0) void track(service.refresh())
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = windowFor()
    })
})
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
let closed = false
let closing = false
app.on('before-quit', (event) => {
    if (!store || closed) return
    event.preventDefault()
    if (closing) return
    closing = true
    const resume = service?.prepareToClose()
    void (async () => {
        // Stop producers before sealing the writer queue. Already accepted operations
        // may still checkpoint while their network requests finish.
        while (work.size) await Promise.allSettled([...work])
        await store.shutdown()
    })()
        .then(() => {
            closed = true
            app.quit()
        })
        .catch((error: unknown) => {
            closing = false
            resume?.()
            dialog.showErrorBox(
                'Journal could not be saved',
                `${error instanceof Error ? error.message : String(error)}\nRetry saving before closing the app.`
            )
        })
})
