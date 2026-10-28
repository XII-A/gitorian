import { NotionDiscoveryCache } from './notion-discovery-cache'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, protocol } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ReplyUpdates } from '../shared/state-updates'
import { shareSnapshot } from '../shared/snapshot'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { ApplicationWork } from './application-work'
import { Cause, Deferred, Effect, Exit, ManagedRuntime, Scope } from 'effect'
import { commandSchema } from '../shared/model'
import type { Reply, RepositoryImportProgress, NotionDiscoveryProgress } from '../shared/model'
import { JournalDatabase } from './journal-database'
import type { JournalView } from './database/types'
import { weekOf } from '../shared/model'
import { ConnectionProfileCache } from './connection-profiles'
import { Vault } from './vault'
import { Http } from './http'
import { GitHub } from './github'
import { Notion, makeNotion } from './notion'
import { desktopLayer } from './desktop-layer'
import type { DesktopEnvironment } from './desktop-layer'
import { NotionConnection } from './notion-connection'
import { NotionSetupStore } from './notion-setup'
import { JournalService } from './service'
import { inspectRepository } from './git'
import { watchWindowTitleBar } from './window-title-bar'
import { imageLimits, imageIdPattern, imageExtension } from '../shared/images'
import { WindowsUpdater } from './windows-updater'
import { AppUpdates } from './app-updates'
if (!app.isPackaged && process.env.GITORIAN_DEV_PROFILE) app.setPath('userData', process.env.GITORIAN_DEV_PROFILE)
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
let store: JournalDatabase
let service: JournalService
let restoring = false
let updating = false
let notionConnection: NotionConnection | undefined
let stopNotionPages: (() => void) | undefined
const referenceWindows = new Set<number>()
const referencePins = new Map<number, { kind: string; id: string }>()
let runtime: ManagedRuntime.ManagedRuntime<DesktopEnvironment, never>
let work: ApplicationWork
const native = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation, catch: (error) => error })
function execute<A, E>(operation: Effect.Effect<A, E, DesktopEnvironment>): Promise<A> {
    const result = runtime.runPromiseExit(operation).then((exit) => {
        if (Exit.isSuccess(exit)) return exit.value
        throw Cause.squash(exit.cause)
    })
    void result.catch(() => {
        /* Detached desktop work is observed; awaiters retain the original failure. */
    })
    return result
}
function runNative<A>(operation: () => Promise<A>): Promise<A> {
    return execute(work.accept(native(operation)))
}
function holdJournal(): () => void {
    const scope = runtime.runSync(Scope.make())
    runtime.runSync(Scope.extend(service.suspend, scope))
    return () => runtime.runSync(Scope.close(scope, Exit.void))
}
function windowFor(reference?: { kind: string; id: string }): BrowserWindow {
    const window = new BrowserWindow({
        title: 'Gitorian',
        icon: join(directory, '../../resources/icon.png'),
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
    if (reference) {
        referenceWindows.add(contentsId)
        referencePins.set(contentsId, reference)
    }
    window.on('closed', () => {
        referenceWindows.delete(contentsId)
        referencePins.delete(contentsId)
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
void app.whenReady().then(async () => {
    ipcMain.handle('journal:clipboard', (event, input: unknown) => {
        const action = z.enum(['cut', 'copy', 'paste']).parse(input)
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown desktop window')
        event.sender[action]()
    })
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
    store = await JournalDatabase.open(join(app.getPath('userData'), 'journal.sqlite'))
    ipcMain.handle('journal:image-save', async (event, input: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown journal window')
        const id = z.string().regex(imageIdPattern).parse(input)
        const image = await store.image(id)
        if (!image) throw new Error('This image is unavailable. Restore it from a backup.')
        const result = await dialog.showSaveDialog(window, {
            defaultPath: `journal-image.${imageExtension(image.mime)}`,
            filters: [{ name: 'Image', extensions: [imageExtension(image.mime)] }]
        })
        if (result.filePath) await writeFile(result.filePath, image.bytes)
    })
    protocol.handle('journal-image', async (request) => {
        const url = new URL(request.url)
        const id = url.pathname.slice(1)
        if (request.method !== 'GET' || url.host !== 'local' || url.search || url.hash || !imageIdPattern.test(id))
            return new Response(null, { status: 404 })
        const image = await store.image(id)
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
        runNative(async () => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (
                !window ||
                event.senderFrame !== window.webContents.mainFrame ||
                referenceWindows.has(event.sender.id) ||
                closing ||
                restoring ||
                updating
            )
                throw new Error('Choose an editable journal window.')
            const request = z.object({ restoreId: z.string().optional() }).parse(input)
            if (request.restoreId !== store.generation) throw new Error('The journal changed. Insert the image again.')
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
                if ((await stat(path)).size > imageLimits.bytes) throw new Error('Choose an image smaller than 5 MB.')
                ids.push(await store.importImage(await readFile(path), request.restoreId))
            }
            return ids
        })
    )
    ipcMain.handle('journal:image-import', (event, input: unknown) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (
            !window ||
            event.senderFrame !== window.webContents.mainFrame ||
            referenceWindows.has(event.sender.id) ||
            closing ||
            restoring ||
            updating
        )
            throw new Error('Choose an editable journal window.')
        const request = z
            .object({
                bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= imageLimits.bytes),
                restoreId: z.string().optional()
            })
            .parse(input)
        if (request.restoreId !== store.generation) throw new Error('The journal changed. Insert the image again.')
        return runNative(() => store.importImage(request.bytes, request.restoreId))
    })
    const vault = new Vault(app.getPath('userData'))
    runtime = ManagedRuntime.make(
        desktopLayer(store, vault, {
            origin:
                (!app.isPackaged && process.env.GITORIAN_NOTION_OAUTH_ORIGIN) ||
                import.meta.env.MAIN_VITE_NOTION_OAUTH_ORIGIN ||
                '',
            fetcher: fetch,
            recovery: new NotionSetupStore(join(app.getPath('userData'), 'notion-setup.json'))
        })
    )
    work = runtime.runSync(ApplicationWork)
    service = runtime.runSync(JournalService)
    const http = runtime.runSync(Http)
    const github = runtime.runSync(GitHub)
    const notion = runtime.runSync(Notion)
    const connection = runtime.runSync(NotionConnection)
    notionConnection = connection
    const notionDiscovery = new NotionDiscoveryCache(join(app.getPath('userData'), 'notion-pages.json'))
    const notionReads = new Map<string, AbortController>()
    stopNotionPages = () => {
        for (const read of notionReads.values()) read.abort(new Error('Notion page read cancelled.'))
        notionReads.clear()
        notionDiscovery.cancel()
    }
    let notionPickerGeneration = 0
    let availableNotionPages: Effect.Effect.Success<ReturnType<Notion['accessiblePages']>> = []
    const profiles = new ConnectionProfileCache(
        join(app.getPath('userData'), 'connection-profiles.json'),
        (service) => (service === 'notion' ? connection.profileKey() : vault.get(service)),
        (service) =>
            service === 'notion'
                ? execute(notion.profile())
                : Promise.resolve({
                      name: store.config.settings.githubLogin,
                      avatarUrl: `https://github.com/${encodeURIComponent(store.config.settings.githubLogin)}.png?size=64`
                  })
    )
    mainWindow = windowFor()
    const updater = new WindowsUpdater()
    const appUpdates = new AppUpdates(
        process.platform === 'win32' && (app.isPackaged || updater.forceDevUpdateConfig) ? updater : undefined,
        async () => {
            if (closing || restoring) throw new Error('Journal is busy')
            updating = true
            const resume = holdJournal()
            try {
                await execute(work.drain)
            } catch (error) {
                updating = false
                resume()
                throw error
            }
            return () => {
                updating = false
                resume()
            }
        }
    )
    const updateOwner = (event: IpcMainInvokeEvent) => {
        if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame)
            throw new Error('Use the main journal window to update Gitorian')
    }
    ipcMain.handle('journal:clipboard-text', (event, text: unknown) => {
        const trusted = BrowserWindow.fromWebContents(event.sender)
        if (!trusted || event.senderFrame !== event.sender.mainFrame || typeof text !== 'string')
            throw new Error('Invalid clipboard request')
        clipboard.writeText(text)
    })
    ipcMain.handle('journal:app-update-state', (event) => {
        updateOwner(event)
        return appUpdates.snapshot()
    })
    ipcMain.handle('journal:app-update-install', async (event) => {
        updateOwner(event)
        await appUpdates.install()
        return appUpdates.snapshot()
    })
    appUpdates.subscribe((state) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('journal:app-update-state', state)
    })
    appUpdates.start()
    const commandHandler = (event: IpcMainInvokeEvent, input: unknown) =>
        Effect.gen(function* () {
            const command = commandSchema.parse(input)
            const trusted = BrowserWindow.fromWebContents(event.sender)
            if (!trusted || event.senderFrame !== trusted.webContents.mainFrame)
                return yield* Effect.fail(new Error('Unknown desktop window'))
            if (
                referenceWindows.has(event.sender.id) &&
                !['state', 'view', 'entryHistory', 'entry', 'details', 'open'].includes(command.type)
            )
                return yield* Effect.fail(new Error('Reference windows are read-only'))
            switch (command.type) {
                case 'loadWeek':
                    yield* service.startRefresh({ since: command.since, missingOnly: true })
                    return yield* service.reply()
                case 'refresh':
                    if (command.since) return yield* service.handle(command)
                    yield* service.startRefresh({ ...command, resume: true })
                    return yield* service.reply({ message: 'Activity refresh started. You can keep writing.' })
                case 'backfill': {
                    const repository = store.config.repositories.find((item) => item.id === command.repositoryId)
                    if (!repository || repository.removed)
                        return yield* Effect.fail(new Error('Choose a tracked repository.'))
                    if (command.since > repository.trackingStart)
                        return yield* Effect.fail(new Error('Choose a date before the current history start.'))
                    yield* service.startRefresh({
                        repositoryId: command.repositoryId,
                        since: command.since,
                        resume: true
                    })
                    return yield* service.reply({ message: 'Older activity is being acquired in the background.' })
                }
                case 'details': {
                    const handled = yield* Effect.gen(function* () {
                        return yield* service.handle(command)
                    }).pipe(
                        Effect.catchAll((error) =>
                            Effect.gen(function* () {
                                return yield* service.reply({
                                    detailError: error instanceof Error ? error.message : String(error)
                                })
                            })
                        )
                    )
                    return handled
                }
                case 'addRepository': {
                    const path = yield* native(() => folder())
                    if (path) yield* service.addRepository(path)
                    break
                }
                case 'addRepositories':
                case 'importRepositories': {
                    const admitted = yield* Deferred.make<undefined>()
                    let lastStage = ''
                    let lastSent = 0
                    const progress = (update: RepositoryImportProgress) => {
                        if (update.stage === 'processing') Deferred.unsafeDone(admitted, Effect.succeed(undefined))
                        const finished = update.stage === 'processing' && update.completed === update.total
                        if (update.stage !== lastStage || finished || Date.now() - lastSent >= 50) {
                            lastStage = update.stage
                            lastSent = Date.now()
                            if (!event.sender.isDestroyed() && !event.sender.isLoadingMainFrame())
                                event.sender.send('journal:repository-import', update)
                        }
                    }
                    if (store.config.repositoryImport?.status === 'running')
                        return yield* service.reply({ message: 'A repository import is already running.' })
                    if (command.type === 'addRepositories') {
                        progress({ stage: 'selecting' })
                        const path = yield* native(() => folder())
                        if (!path) return yield* service.reply()
                        return yield* service.scanRepositories(path, progress)
                    }
                    const imported = yield* Deferred.make<Reply, Error>()
                    yield* work.fork(
                        service.importRepositories(command.scanId, command.paths, progress).pipe(
                            Effect.tap(() =>
                                store.config.settings.refreshMinutes > 0 ? service.startRefresh() : Effect.void
                            ),
                            Effect.onExit((exit) =>
                                Effect.gen(function* () {
                                    yield* Deferred.succeed(admitted, undefined)
                                    yield* Deferred.done(imported, exit)
                                    if (Exit.isFailure(exit)) {
                                        const error = Cause.squash(exit.cause)
                                        yield* native(() =>
                                            store.saveProgress({
                                                repositoryImport: {
                                                    id: store.config.repositoryImport?.id,
                                                    status: 'error',
                                                    completed: 0,
                                                    total: 0,
                                                    message: error instanceof Error ? error.message : String(error)
                                                }
                                            })
                                        ).pipe(Effect.orDie)
                                    }
                                })
                            )
                        )
                    )
                    yield* Deferred.await(admitted)
                    if ((yield* service.reply()).state.repositoryImport?.status !== 'running')
                        return yield* Deferred.await(imported)
                    return yield* service.reply({ message: 'Import started. You can close Settings and keep writing.' })
                }
                case 'relocate': {
                    const path = yield* native(() => folder())
                    if (path) {
                        const inspected = yield* native(() => inspectRepository(path))
                        const repository = store.config.repositories.find((item) => item.id === command.id)
                        if (!repository) return yield* Effect.fail(new Error('Repository not found'))
                        repository.path = inspected.path
                        repository.branches = inspected.branches
                        repository.remotes = inspected.remotes
                        repository.available = true
                        repository.removed = false
                        yield* native(() => store.saveRepository(repository))
                    }
                    break
                }
                case 'notionStart': {
                    notionPickerGeneration++
                    stopNotionPages?.()
                    availableNotionPages = []
                    const notionAuthorization = yield* connection.start()
                    {
                        const handled = yield* Effect.gen(function* () {
                            yield* native(() => openExternal(notionAuthorization.url))
                        }).pipe(
                            Effect.catchAll((_error) =>
                                Effect.gen(function* () {
                                    return yield* service.reply({
                                        notionAuthorization,
                                        message: 'Could not open your browser. Try Open Notion again.'
                                    })
                                })
                            )
                        )
                        if (handled !== undefined) return handled
                    }
                    return yield* service.reply({ notionAuthorization })
                }
                case 'notionCancel':
                    yield* connection.cancel()
                    notionPickerGeneration++
                    stopNotionPages?.()
                    availableNotionPages = []
                    break
                case 'notionPoll': {
                    const result = yield* connection.poll()
                    if ('pending' in result)
                        return yield* service.reply({ notionPending: { interval: result.interval } })
                    return yield* service.reply()
                }
                case 'notionPages': {
                    if (command.query && command.parentId)
                        return yield* Effect.fail(new Error('Choose a page to expand or enter a search.'))
                    if (!command.parentId) stopNotionPages?.()
                    const controller = new AbortController()
                    notionReads.set(command.requestId, controller)
                    const generation = notionPickerGeneration
                    {
                        const handled = yield* Effect.gen(function* () {
                            const token = yield* connection.pendingToken()
                            controller.signal.throwIfAborted()
                            if (generation !== notionPickerGeneration)
                                return yield* Effect.fail(new Error('Notion page read cancelled.'))
                            const parent = command.parentId
                                ? availableNotionPages.find((page) => page.id === command.parentId)
                                : undefined
                            if (command.parentId && !parent)
                                return yield* Effect.fail(new Error('Choose an available page to expand.'))
                            const discovery = makeNotion(http, connection.pendingToken)
                            const progress = (progress: NotionDiscoveryProgress) => {
                                if (
                                    !controller.signal.aborted &&
                                    generation === notionPickerGeneration &&
                                    !event.sender.isDestroyed()
                                )
                                    event.sender.send('journal:notion-discovery', {
                                        requestId: command.requestId,
                                        progress
                                    })
                            }
                            const pages =
                                command.query || parent
                                    ? yield* discovery.accessiblePages(progress, controller.signal, {
                                          query: command.query,
                                          parent
                                      })
                                    : yield* native(() =>
                                          notionDiscovery.pages(
                                              token,
                                              (signal, notify) =>
                                                  execute(
                                                      discovery.accessiblePages(
                                                          notify,
                                                          AbortSignal.any([signal, controller.signal])
                                                      )
                                                  ),
                                              progress
                                          )
                                      )
                            controller.signal.throwIfAborted()
                            if (generation !== notionPickerGeneration)
                                return yield* Effect.fail(new Error('Notion page read cancelled.'))
                            const known = new Map(availableNotionPages.map((page) => [page.id, page]))
                            for (const page of pages) known.set(page.id, page)
                            availableNotionPages = [...known.values()]
                            if (parent || command.query) notionDiscovery.rememberAll(token, pages)
                            return yield* service.reply({ notionPages: pages })
                        }).pipe(
                            Effect.ensuring(
                                Effect.sync(() => {
                                    if (notionReads.get(command.requestId) === controller)
                                        notionReads.delete(command.requestId)
                                })
                            )
                        )
                        return handled
                    }
                }
                case 'notionChoose': {
                    notionPickerGeneration++
                    stopNotionPages?.()
                    availableNotionPages = []
                    if (yield* connection.choose()) return yield* service.reply()
                    const notionAuthorization = yield* connection.start()
                    {
                        const handled = yield* Effect.gen(function* () {
                            yield* native(() => openExternal(notionAuthorization.url))
                        }).pipe(
                            Effect.catchAll((_error) =>
                                Effect.sync(() => {
                                    /* The morph keeps Open Notion available. */
                                })
                            )
                        )
                        if (handled !== undefined) return handled
                    }
                    return yield* service.reply({ notionAuthorization })
                }
                case 'notionConfirm': {
                    const previousIdentity = connection.profileKey()
                    const selection = command.selection
                    const page =
                        selection.kind === 'existing'
                            ? availableNotionPages.find((page) => page.kind === 'page' && page.id === selection.pageId)
                            : undefined
                    if (selection.kind === 'existing' && !page)
                        return yield* Effect.fail(
                            new Error('Refresh pages and choose a destination.')
                            // Selection no longer waits for the full content crawl. Cancel
                            // that read before saving so its late result cannot change the picker.
                        )
                    // Selection no longer waits for the full content crawl. Cancel
                    // that read before saving so its late result cannot change the picker.
                    notionPickerGeneration++
                    stopNotionPages?.()
                    const destination = yield* connection.completeJournal({
                        title: selection.kind === 'new' ? selection.title : undefined,
                        destination: page
                            ? {
                                  kind: 'page',
                                  id: page.id,
                                  title: page.title,
                                  icon: page.icon,
                                  url: page.url,
                                  titleProperty: 'Name',
                                  dateProperty: ''
                              }
                            : undefined
                    })
                    notionDiscovery.remember(yield* connection.token(), {
                        ...page,
                        kind: 'page',
                        id: destination.id,
                        title: destination.title || page?.title || 'Untitled',
                        url: destination.url || page?.url || '',
                        icon: destination.icon
                    })
                    if (previousIdentity !== connection.profileKey()) profiles.clear('notion')
                    yield* connection.cancel()
                    break
                }
                case 'notionDestination':
                    yield* connection.refreshDestination().pipe(Effect.catchAll(() => Effect.void))
                    break
                case 'connectionProfiles':
                    return yield* service.reply({ connectionProfiles: profiles.snapshot() })
                case 'refreshConnectionProfile':
                    yield* native(() => profiles.refresh(command.service))
                    return yield* service.reply({ connectionProfiles: profiles.snapshot() })
                case 'githubStart': {
                    const device = yield* github.start()
                    {
                        const handled = yield* Effect.gen(function* () {
                            yield* native(() => openExternal(device.url))
                        }).pipe(
                            Effect.catchAll((_error) =>
                                Effect.gen(function* () {
                                    return yield* service.reply({
                                        device,
                                        message:
                                            'Could not open your browser. Use Open browser or visit the displayed address.'
                                    })
                                })
                            )
                        )
                        if (handled !== undefined) return handled
                    }
                    return yield* service.reply({ device })
                }
                case 'githubPoll': {
                    const account = yield* github.poll()
                    if ('pending' in account)
                        return yield* service.reply({ devicePending: { interval: account.interval } })
                    profiles.clear('github')
                    yield* native(() => store.setGitHubLogin(account.login))
                    for (const repository of store.config.repositories)
                        yield* native(() =>
                            store.saveRepository({
                                ...repository,
                                emails: [...new Set([...repository.emails, ...account.emails])]
                            })
                        )
                    yield* work.fork(native(() => profiles.refresh('github')))
                    break
                }
                case 'disconnect':
                    if (command.service === 'notion') {
                        notionPickerGeneration++
                        stopNotionPages?.()
                        notionDiscovery.clear()
                        availableNotionPages = []
                        yield* connection.disconnect()
                    } else vault.set(command.service, '')
                    profiles.clear(command.service)
                    break
                case 'export': {
                    const result = yield* native(() =>
                        dialog.showSaveDialog(mainWindow, {
                            defaultPath: 'gitorian-backup.json',
                            filters: [{ name: 'Tracking backup', extensions: ['json'] }]
                        })
                    )
                    if (result.filePath) {
                        yield* native(async () => writeFile(result.filePath, await store.export(), 'utf8'))
                    }
                    break
                }
                case 'import': {
                    restoring = true
                    yield* service.suspend
                    {
                        const handled = yield* Effect.gen(function* () {
                            yield* work.drain
                            const result = yield* native(() =>
                                dialog.showOpenDialog(mainWindow, {
                                    properties: ['openFile'],
                                    filters: [{ name: 'Tracking backup', extensions: ['json'] }]
                                })
                            )
                            if (!result.canceled) {
                                const confirmation = yield* native(() =>
                                    dialog.showMessageBox(mainWindow, {
                                        type: 'warning',
                                        buttons: ['Cancel', 'Replace local tracking'],
                                        defaultId: 0,
                                        cancelId: 0,
                                        message: 'Replace local tracking and drafts with this backup?',
                                        detail: 'Export your current data first if you need to keep it.'
                                    })
                                )
                                if (confirmation.response === 1) {
                                    if ((yield* native(() => stat(result.filePaths[0]))).size > imageLimits.backup)
                                        return yield* Effect.fail(new Error('The backup exceeds the 512 MiB limit.'))
                                    const backup = yield* native(() => readFile(result.filePaths[0], 'utf8'))
                                    yield* native(() => store.restore(backup))
                                    vault.set('github', '')
                                    notionPickerGeneration++
                                    stopNotionPages?.()
                                    notionDiscovery.clear()
                                    availableNotionPages = []
                                    yield* connection.disconnect()
                                    return yield* service.reply({ message: 'Backup imported.' })
                                }
                            }
                        }).pipe(
                            Effect.ensuring(
                                Effect.sync(() => {
                                    restoring = false
                                })
                            )
                        )
                        if (handled !== undefined) return handled
                    }
                    break
                }
                case 'open':
                    yield* native(() => openExternal(command.url))
                    break
                case 'popout':
                    windowFor(command)
                    break
                case 'state': {
                    const remotes: Record<string, string[]> = {}
                    for (const repository of store.config.repositories)
                        remotes[repository.id] = repository.remotes ?? []
                    return { ...(yield* service.reply()), remotes }
                }
                default:
                    return yield* service.handle(command)
            }
            return yield* service.reply()
        }).pipe(Effect.scoped)
    const views = new Map<number, JournalView>()
    const viewStates = new Map<number, Reply['state']>()
    const watchedWindows = new Set<number>()
    const durableCommand = async (event: IpcMainInvokeEvent, input: unknown) => {
        const command = commandSchema.parse(input)
        const trusted = BrowserWindow.fromWebContents(event.sender)
        if (!trusted || event.senderFrame !== trusted.webContents.mainFrame) throw new Error('Unknown desktop window')
        if (!views.has(event.sender.id) && referencePins.has(event.sender.id)) {
            const reference = referencePins.get(event.sender.id)!
            const week = weekOf(new Date(), store.config.settings)
            views.set(event.sender.id, {
                since: week,
                until: new Date(Date.parse(week) + 6 * 86400000).toISOString().slice(0, 10),
                ...(reference.kind === 'entry' ? { entryId: reference.id } : { activityId: reference.id })
            })
        }
        if (command.type === 'view') {
            const { cursor: _cursor, ...view } = command.view
            views.set(event.sender.id, view)
        }
        if (command.type === 'details') {
            const week = weekOf(new Date(), store.config.settings)
            const view = views.get(event.sender.id) ?? {
                since: week,
                until: new Date(Date.parse(week) + 6 * 86400000).toISOString().slice(0, 10)
            }
            views.set(event.sender.id, { ...view, activityId: command.activityId })
        }
        const reply = await execute(
            work.accept(
                Effect.suspend(() => {
                    if (closing || restoring || updating)
                        return Effect.fail(new Error('Journal is busy; retry after it finishes saving or restoring'))
                    return command.type === 'view' ? service.reply() : commandHandler(event, command)
                })
            )
        )
        let view = views.get(event.sender.id)
        let previous = viewStates.get(event.sender.id)
        let continuation = command.type === 'view' ? command.view.cursor : undefined
        const sameRange = () =>
            previous?.restoreId === store.generation &&
            previous?.activityPage?.since === view?.since &&
            previous?.activityPage?.until === view?.until
        if (!sameRange() || (continuation && previous?.activityPage?.next?.id !== continuation.id))
            continuation = undefined
        let state = await store.readWorkspace(continuation ? { ...view!, cursor: continuation } : view)
        const mergePage = (before: Reply['state'], next: Reply['state']) => ({
            ...next,
            activities: [...new Map([...before.activities, ...next.activities].map((a) => [a.id, a])).values()],
            revisions: [...new Map([...before.revisions, ...next.revisions].map((r) => [r.id, r])).values()],
            entries: [...new Map([...before.entries, ...next.entries].map((e) => [e.id, e])).values()],
            coverage: [...new Map([...before.coverage, ...next.coverage].map((c) => [JSON.stringify(c), c])).values()]
        })
        if (continuation && previous && sameRange()) state = mergePage(previous, state)
        else if (previous && sameRange()) {
            // Refresh already visible pages with current records; never retain stale earlier pages.
            while (state.activityPage?.next && state.activities.length < previous.activities.length) {
                const page = await store.readWorkspace({ ...view!, cursor: state.activityPage.next })
                state = mergePage(state, page)
            }
        }
        if (view !== views.get(event.sender.id)) {
            view = views.get(event.sender.id)
            state = await store.readWorkspace(view)
            previous = viewStates.get(event.sender.id)
        }
        state = shareSnapshot(previous?.restoreId === state.restoreId ? previous : undefined, state)
        viewStates.set(event.sender.id, state)
        if (!watchedWindows.has(event.sender.id)) {
            watchedWindows.add(event.sender.id)
            event.sender.once('destroyed', () => {
                views.delete(event.sender.id)
                viewStates.delete(event.sender.id)
                watchedWindows.delete(event.sender.id)
            })
        }
        return { ...reply, state }
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
    const refreshIfActive = Effect.gen(function* () {
        if (closing || restoring || updating) return
        const minutes = store.config.settings.refreshMinutes
        const elapsed =
            Date.now() - new Date(store.config.lastRefreshAttempt ?? store.config.lastRefreshed ?? 0).getTime()
        const pending = Object.entries(store.config.acquisition ?? {}).find(
            ([key, status]) =>
                store.config.repositories.some(
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
            yield* service.startRefresh({ repositoryId, source: source === 'git' ? 'git' : 'github' })
            return
        }
        if (minutes > 0 && !mainWindow.isDestroyed() && mainWindow.isVisible() && elapsed >= minutes * 60000)
            yield* service.startRefresh()
    })
    void execute(work.repeat(5000, refreshIfActive))
    if (store.config.settings.refreshMinutes > 0) void execute(service.startRefresh())
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
    stopNotionPages?.()
    if (!store || closed) return
    event.preventDefault()
    if (closing) return
    closing = true
    const resume = holdJournal()
    void (async () => {
        if (notionConnection) await execute(notionConnection.cancel())
        // Stop producers before sealing the writer queue. Already accepted operations
        // may still checkpoint while their network requests finish.
        await execute(work.shutdown(native(() => store.close())))
        await runtime.dispose()
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
