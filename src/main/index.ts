import { app, BrowserWindow, dialog, ipcMain, shell, protocol } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ReplyUpdates } from '../shared/state-updates'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { Effect } from 'effect'
import { commandSchema } from '../shared/model'
import type { RepositoryImportProgress } from '../shared/model'
import { Store } from './store'
import { ConnectionProfileCache } from './connection-profiles'
import { Vault } from './vault'
import { Http } from './http'
import { GitHub } from './github'
import { Notion } from './notion'
import { JournalService } from './service'
import { inspectRepository } from './git'
import { watchWindowTitleBar } from './window-title-bar'
import { imageLimits, imageIdPattern, imageExtension } from '../shared/images'

// Chromium 152 hides the thread's native cursor, including inside file dialogs.
// Remove after Electron includes chromium/chromium@a2be9eeac1d506dae63b2994cd605d83bb7622ea.
if (process.platform === 'win32') {
    const disabledFeatures = new Set(
        app.commandLine
            .getSwitchValue('disable-features')
            .split(',')
            .map((feature) => feature.trim())
            .filter(Boolean)
    )
    disabledFeatures.add('HideCursorWhileTyping')
    app.commandLine.appendSwitch('disable-features', [...disabledFeatures].join(','))
}

protocol.registerSchemesAsPrivileged([
    { scheme: 'journal-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const directory = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow
let store: Store
let service: JournalService
let restoring = false
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
        frame: process.platform !== 'win32',
        webPreferences: {
            preload: join(directory, '../preload/index.cjs'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
        }
    })
    if (process.platform === 'win32') {
        window.removeMenu()
        watchWindowTitleBar(window)
    }
    const sendWindowState = () => {
        if (!window.webContents.isDestroyed())
            window.webContents.send('journal:window-state', { maximized: window.isMaximized() })
    }
    window.on('maximize', sendWindowState)
    window.on('unmaximize', sendWindowState)
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
    ipcMain.handle('journal:window', (event, input: unknown) => {
        const action = z.enum(['state', 'minimize', 'toggleMaximize', 'close']).parse(input)
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown desktop window')
        switch (action) {
            case 'minimize':
                window.minimize()
                break
            case 'toggleMaximize':
                if (window.isMaximized()) window.unmaximize()
                else window.maximize()
                break
            case 'close':
                window.close()
                return
        }
        return { maximized: window.isMaximized() }
    })
    store = new Store(join(app.getPath('userData'), 'weekly-j.sqlite'))
    store.enableBackgroundWrites()
    ipcMain.handle('journal:image-save', async (event, input: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown journal window')
        const id = z.string().regex(imageIdPattern).parse(input)
        const image = store.image(id)
        if (!image) throw new Error('This image is unavailable. Restore it from a backup.')
        const result = await dialog.showSaveDialog(window, {
            defaultPath: `journal-image.${imageExtension(image.mime)}`,
            filters: [{ name: 'Image', extensions: [imageExtension(image.mime)] }]
        })
        if (result.filePath) await writeFile(result.filePath, image.bytes)
    })
    protocol.handle('journal-image', (request) => {
        const url = new URL(request.url)
        const id = url.pathname.slice(1)
        if (request.method !== 'GET' || url.host !== 'local' || url.search || url.hash || !imageIdPattern.test(id))
            return new Response(null, { status: 404 })
        const image = store.image(id)
        return image
            ? new Response(new Uint8Array(image.bytes), {
                  headers: {
                      'Content-Type': image.mime,
                      'X-Content-Type-Options': 'nosniff',
                      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
                      'Cache-Control': 'no-store'
                  }
              })
            : new Response(null, { status: 404 })
    })
    ipcMain.handle('journal:image-choose', (event, input: unknown) =>
        track(
            (async () => {
                const window = BrowserWindow.fromWebContents(event.sender)
                if (
                    !window ||
                    event.senderFrame !== window.webContents.mainFrame ||
                    referenceWindows.has(event.sender.id) ||
                    closing ||
                    restoring
                )
                    throw new Error('Choose an editable journal window.')
                const request = z.object({ restoreId: z.string().optional() }).parse(input)
                if (request.restoreId !== store.state.restoreId)
                    throw new Error('The journal changed. Insert the image again.')
                const result = await dialog.showOpenDialog(window, {
                    title: 'Choose journal images',
                    properties: ['openFile', 'multiSelections'],
                    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
                })
                if (result.canceled) return []
                if (result.filePaths.length > imageLimits.batch) throw new Error('Choose up to 10 images at a time.')
                const ids: string[] = []
                for (const path of result.filePaths) {
                    if (closing || restoring || window.isDestroyed())
                        throw new Error('The journal changed. Insert the image again.')
                    if ((await stat(path)).size > imageLimits.bytes)
                        throw new Error('Choose an image smaller than 5 MB.')
                    ids.push(await store.importImage(await readFile(path), request.restoreId))
                }
                return ids
            })()
        )
    )
    ipcMain.handle('journal:image-import', (event, input: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (
            !window ||
            event.senderFrame !== window.webContents.mainFrame ||
            referenceWindows.has(event.sender.id) ||
            closing ||
            restoring
        )
            throw new Error('Choose an editable journal window.')
        const request = z
            .object({
                bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= imageLimits.bytes),
                restoreId: z.string().optional()
            })
            .parse(input)
        if (request.restoreId !== store.state.restoreId) throw new Error('The journal changed. Insert the image again.')
        return track(store.importImage(request.bytes, request.restoreId))
    })
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
    const notion = new Notion(http, () => vault.get('notion'), store)
    const profiles = new ConnectionProfileCache(
        join(app.getPath('userData'), 'connection-profiles.json'),
        (service) => vault.get(service),
        (service) =>
            service === 'notion'
                ? notion.profile()
                : Promise.resolve({
                      name: store.state.settings.githubLogin,
                      avatarUrl: `https://github.com/${encodeURIComponent(store.state.settings.githubLogin)}.png?size=64`
                  })
    )
    service = new JournalService(store, github, notion, () => ({
        github: !!vault.get('github'),
        notion: !!vault.get('notion'),
        protectedStorage: vault.protected()
    }))
    mainWindow = windowFor()
    const commandHandler = async (event: IpcMainInvokeEvent, input: unknown) => {
        const command = commandSchema.parse(input)
        const trusted = BrowserWindow.fromWebContents(event.sender)
        if (!trusted || event.senderFrame !== trusted.webContents.mainFrame) throw new Error('Unknown desktop window')
        if (referenceWindows.has(event.sender.id) && !['state', 'details', 'open'].includes(command.type))
            throw new Error('Reference windows are read-only')
        switch (command.type) {
            case 'loadWeek':
                void track(service.refresh({ since: command.since, missingOnly: true }))
                return service.reply()
            case 'refresh':
                if (command.since) return track(service.handle(command))
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
            case 'addRepositories':
            case 'importRepositories': {
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
                if (store.state.repositoryImport?.status === 'running')
                    return service.reply({ message: 'A repository import is already running.' })
                if (command.type === 'addRepositories') {
                    progress({ stage: 'selecting' })
                    const path = await folder()
                    if (!path) return service.reply()
                    return await track(service.scanRepositories(path, progress))
                }
                const importing = service.importRepositories(command.scanId, command.paths, progress)
                if (service.reply().state.repositoryImport?.status !== 'running') return await importing
                void track(
                    importing.then(() => {
                        if (store.state.settings.refreshMinutes > 0) void track(service.refresh())
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
            case 'notionConnect': {
                const profile = await new Notion(http, () => command.token).profile()
                profiles.clear('notion')
                vault.set('notion', command.token)
                void profiles.refresh('notion', profile)
                break
            }
            case 'notionTestDestination':
                await notion.verifyDestination(command.destination)
                return service.reply({ message: 'Destination is reachable.' })
            case 'connectionProfiles':
                return service.reply({ connectionProfiles: profiles.snapshot() })
            case 'refreshConnectionProfile':
                await profiles.refresh(command.service)
                return service.reply({ connectionProfiles: profiles.snapshot() })
            case 'githubStart': {
                const device = await github.start()
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
                profiles.clear('github')
                store.state.settings.githubLogin = account.login
                for (const repository of store.state.repositories)
                    repository.emails = [...new Set([...repository.emails, ...account.emails])]
                store.persist()
                void profiles.refresh('github')
                break
            }
            case 'disconnect':
                vault.set(command.service, '')
                profiles.clear(command.service)
                break
            case 'export': {
                const result = await dialog.showSaveDialog(mainWindow, {
                    defaultPath: 'weekly-j-backup.json',
                    filters: [{ name: 'Tracking backup', extensions: ['json'] }]
                })
                if (result.filePath) {
                    await store.flush()
                    await writeFile(result.filePath, store.export(), 'utf8')
                }
                break
            }
            case 'import': {
                const priorWork = [...work]
                restoring = true
                const resume = service.prepareToClose()
                try {
                    await Promise.allSettled(priorWork)
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
                            if ((await stat(result.filePaths[0])).size > imageLimits.backup)
                                throw new Error('The backup exceeds the 512 MiB limit.')
                            await store.restore(await readFile(result.filePaths[0], 'utf8'))
                            await store.flush()
                            vault.set('github', '')
                            vault.set('notion', '')
                            return service.reply({ message: 'Backup imported.' })
                        }
                    }
                } finally {
                    restoring = false
                    resume()
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
        if (closing || restoring) throw new Error('Journal is busy; retry after it finishes saving or restoring')
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
        if (closing || restoring) return
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
