import { readFile, writeFile } from 'node:fs/promises'
import nodePath from 'node:path'

import { Effect } from 'effect'
import type { IpcMainInvokeEvent } from 'electron'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

import type { Command, Reply, RepositoryImportProgress } from '../shared/model'
import { commandSchema } from '../shared/model'
import { inspectRepository } from './git'
import { GitHub } from './github'
import { Http } from './http'
import { Notion } from './notion'
import { JournalService } from './service'
import { Store } from './store'
import { Vault } from './vault'

const directory = import.meta.dirname
let mainWindow: BrowserWindow
let store: Store
let service: JournalService
const referenceWindows = new Set<number>()
const openExternal = async (value: string): Promise<void> => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Only web links can be opened')
    }
    await shell.openExternal(url.toString())
}

const windowFor = (reference?: { kind: string; id: string }): BrowserWindow => {
    const window = new BrowserWindow({
        backgroundColor: '#151715',
        height: 1000,
        minHeight: 640,
        minWidth: reference ? 600 : 1000,
        show: false,
        title: 'weekly-j',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: nodePath.join(directory, '../preload/index.cjs'),
            sandbox: true
        },
        width: reference ? 1400 : 1560
    })
    const contentsId = window.webContents.id
    if (reference) {
        referenceWindows.add(contentsId)
    }
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
    if (process.env.ELECTRON_RENDERER_URL) {
        void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
    } else {
        void window.loadFile(nodePath.join(directory, '../renderer/index.html'), { search: query })
    }
    return window
}

const folder = async (): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return result.canceled ? undefined : result.filePaths[0]
}
const startDesktop = async () => {
    await app.whenReady()
    store = new Store(nodePath.join(app.getPath('userData'), 'weekly-j.sqlite'))
    const vault = new Vault(app.getPath('userData'))
    store.state.transportPauses ??= {}
    const http = new Http(fetch, {
        changed: () => {
            store.persist()
        },
        pauses: store.state.transportPauses
    })
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
    const dispatchDesktop0 = async (command: Command, event: IpcMainInvokeEvent): Promise<Reply | undefined> => {
        switch (command.type) {
            case 'refresh': {
                void service.refresh({ ...command, resume: true })
                return service.reply({ message: 'Activity refresh started. You can keep writing.' })
            }
            case 'backfill': {
                const repository = store.state.repositories.find((item) => item.id === command.repositoryId)
                if (!repository || repository.removed) {
                    throw new Error('Choose a tracked repository.')
                }
                if (command.since > repository.trackingStart) {
                    throw new Error('Choose a date before the current history start.')
                }
                const acquireHistory = async () => {
                    try {
                        await service.backfill(command.repositoryId, command.since)
                    } catch (error) {
                        store.state.refreshError = error instanceof Error ? error.message : String(error)
                        store.persist()
                    }
                }
                acquireHistory()
                return service.reply({ message: 'Older activity is being acquired in the background.' })
            }
            case 'details': {
                try {
                    return await service.handle(command)
                } catch (error) {
                    return service.reply({ detailError: error instanceof Error ? error.message : String(error) })
                }
            }
            case 'addRepository': {
                const path = await folder()
                if (path) {
                    await service.addRepository(path)
                }
                return undefined
            }
            case 'addRepositories': {
                let lastStage = ''
                let lastSent = 0
                const progress = (update: RepositoryImportProgress) => {
                    const finished = update.stage === 'processing' && update.completed === update.total
                    if (update.stage !== lastStage || finished || Date.now() - lastSent >= 50) {
                        lastStage = update.stage
                        lastSent = Date.now()
                        if (!event.sender.isDestroyed() && !event.sender.isLoadingMainFrame()) {
                            event.sender.send('journal:repository-import', update)
                        }
                    }
                }
                progress({ stage: 'selecting' })
                const path = await folder()
                if (!path) {
                    return service.reply()
                }
                if (store.state.repositoryImport?.status === 'running') {
                    return service.reply({ message: 'A repository import is already running.' })
                }
                store.state.repositoryImport = { completed: 0, status: 'running', total: 0 }
                store.persist()
                const acquireRepositories = async () => {
                    try {
                        await service.addRepositories(path, progress)

                        if (store.state.settings.refreshMinutes > 0) {
                            void service.refresh({ afterCurrent: true })
                        }
                    } catch (error) {
                        store.state.repositoryImport = {
                            completed: 0,
                            id: store.state.repositoryImport?.id,
                            message: error instanceof Error ? error.message : String(error),
                            status: 'error',
                            total: 0
                        }
                        store.persist()
                    }
                }
                acquireRepositories()
                return service.reply({ message: 'Import started. You can close Settings and keep writing.' })
            }
            default: {
                throw new Error('Command routed to the wrong desktop handler')
            }
        }
    }

    const dispatchDesktop1 = async (command: Command, _event: IpcMainInvokeEvent): Promise<Reply | undefined> => {
        switch (command.type) {
            case 'relocate': {
                const path = await folder()
                if (path) {
                    const inspected = await inspectRepository(path)
                    const repository = store.state.repositories.find((item) => item.id === command.id)
                    if (!repository) {
                        throw new Error('Repository not found')
                    }
                    repository.path = inspected.path
                    repository.branches = inspected.branches
                    repository.remotes = inspected.remotes
                    repository.available = true
                    repository.removed = false
                    store.persist()
                }
                return undefined
            }
            case 'notionConnect': {
                await new Notion(http, () => command.token).verify()
                vault.set('notion', command.token)
                return undefined
            }
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
                if ('pending' in account) {
                    return service.reply({ devicePending: { interval: account.interval } })
                }
                store.state.settings.githubLogin = account.login
                for (const repository of store.state.repositories) {
                    repository.emails = [...new Set([...repository.emails, ...account.emails])]
                }
                store.persist()
                return undefined
            }
            case 'disconnect': {
                vault.set(command.service, '')
                return undefined
            }
            case 'export': {
                const result = await dialog.showSaveDialog(mainWindow, {
                    defaultPath: 'weekly-j-backup.json',
                    filters: [{ extensions: ['json'], name: 'Tracking backup' }]
                })
                if (result.filePath) {
                    await writeFile(result.filePath, store.export(), 'utf-8')
                }
                return undefined
            }
            case 'import': {
                const result = await dialog.showOpenDialog(mainWindow, {
                    filters: [{ extensions: ['json'], name: 'Tracking backup' }],
                    properties: ['openFile']
                })
                if (!result.canceled) {
                    const confirmation = await dialog.showMessageBox(mainWindow, {
                        buttons: ['Cancel', 'Replace local tracking'],
                        cancelId: 0,
                        defaultId: 0,
                        detail: 'Export your current data first if you need to keep it.',
                        message: 'Replace local tracking and drafts with this backup?',
                        type: 'warning'
                    })
                    if (confirmation.response === 1) {
                        store.restore(await readFile(result.filePaths[0], 'utf-8'))
                        vault.set('github', '')
                        vault.set('notion', '')
                        return service.reply({ message: 'Backup imported.' })
                    }
                }
                return undefined
            }
            default: {
                throw new Error('Command routed to the wrong desktop handler')
            }
        }
    }

    const dispatchDesktop2 = async (command: Command, _event: IpcMainInvokeEvent): Promise<Reply | undefined> => {
        switch (command.type) {
            case 'open': {
                await openExternal(command.url)
                return undefined
            }
            case 'popout': {
                windowFor(command)
                return undefined
            }
            case 'state': {
                const remotes: Record<string, string[]> = {}
                for (const repository of store.state.repositories) {
                    remotes[repository.id] = repository.remotes ?? []
                }
                return { ...service.reply(), remotes }
            }
            default: {
                throw new Error('Command routed to the wrong desktop handler')
            }
        }
    }
    const desktopHandlers = { dispatchDesktop0, dispatchDesktop1, dispatchDesktop2 }
    const desktopRoutes: Partial<Record<Command['type'], keyof typeof desktopHandlers>> = {
        addRepositories: 'dispatchDesktop0',
        addRepository: 'dispatchDesktop0',
        backfill: 'dispatchDesktop0',
        details: 'dispatchDesktop0',
        disconnect: 'dispatchDesktop1',
        export: 'dispatchDesktop1',
        githubPoll: 'dispatchDesktop1',
        githubStart: 'dispatchDesktop1',
        import: 'dispatchDesktop1',
        notionConnect: 'dispatchDesktop1',
        open: 'dispatchDesktop2',
        popout: 'dispatchDesktop2',
        refresh: 'dispatchDesktop0',
        relocate: 'dispatchDesktop1',
        state: 'dispatchDesktop2'
    }
    ipcMain.handle('journal:command', async (event, input: unknown) => {
        const command = commandSchema.parse(input)
        const trusted = BrowserWindow.fromWebContents(event.sender)
        if (!trusted) {
            throw new Error('Unknown desktop window')
        }
        if (referenceWindows.has(event.sender.id) && !['state', 'details', 'open'].includes(command.type)) {
            throw new Error('Reference windows are read-only')
        }
        const route = desktopRoutes[command.type]
        if (!route) {
            return await Effect.runPromise(service.execute(command))
        }
        const reply = await desktopHandlers[route](command, event)
        if (reply) {
            return reply
        }
        return service.reply()
    })
    const refreshIfActive = () => {
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
            void service.refresh({ repositoryId, source: source === 'git' ? 'git' : 'github' })
            return
        }
        if (minutes > 0 && !mainWindow.isDestroyed() && mainWindow.isVisible() && elapsed >= minutes * 60_000) {
            void service.refresh()
        }
    }
    setInterval(refreshIfActive, 5000).unref()
    if (store.state.settings.refreshMinutes > 0) {
        void service.refresh()
    }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = windowFor()
        }
    })
}
startDesktop()
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
app.on('before-quit', () => {
    store?.close()
})
