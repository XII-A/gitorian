import { ProviderConnections } from './ProviderConnections'
import { providerRemote } from '../shared/provider-accounts'
import { RepositoryImportReview } from './RepositoryImportReview'
import { Alert } from './components/arc/alert/alert'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plainText } from '../shared/notion-format'
import type { Command, Reply, Repository, RepositoryImportProgress, State } from '../shared/model'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Button } from './components/arc/button/button'
import { Select } from './components/arc/select/select'
import { Combobox } from './components/arc/combobox/combobox'
import { DatePicker } from './components/arc/date-picker/date-picker'
import { TagInput } from './components/arc/tag-input/tag-input'
import { ImportProgressLabel } from './ImportProgressLabel'
import { Folder, RefreshCw } from 'lucide-react'
import { NotionSignIn } from './NotionSignIn'
import { Switch } from './components/arc/switch/switch'
import { ExpandableCard } from './components/arc/expandable-card/expandable-card'
import { NumberField } from './components/arc/number-field/number-field'
import { SearchField } from './components/arc/search-field/search-field'
import type { EditorHandle } from './Editor'
import { NotionLogoIcon } from '@phosphor-icons/react/dist/csr/NotionLogo'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { Editor } from './Editor'
import { dateKey, dateValue } from './workspace-model'
import { hasUnsavedSettings, timezoneOptions } from './settings-model'
import './settings.css'

export function Settings({
    state,
    connections,
    remotes,
    run,
    close,
    initialSection = 'repositories'
}: {
    state: State
    connections: Reply['connections']
    remotes: Record<string, string[]>
    run: (command: Command) => Promise<Reply | undefined>
    close: () => void
    initialSection?: 'repositories' | 'connections'
}) {
    const [settings, setSettings] = useState(state.settings)
    const [compact, setCompact] = useState(false)
    useEffect(() => {
        const query = window.matchMedia('(max-width: 600px)')
        const update = () => setCompact(query.matches)
        update()
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])
    const [repositories, setRepositories] = useState(state.repositories)
    const [error, setError] = useState('')
    const [status, setStatus] = useState('')
    const [busy, setBusy] = useState('')
    const [section, setSection] = useState<string>(initialSection)
    const [confirmClose, setConfirmClose] = useState(false)
    const [repositorySearch, setRepositorySearch] = useState('')
    const [importProgress, setImportProgress] = useState<RepositoryImportProgress>()
    const [importFlow, setImportFlow] = useState(false)
    const [repositoryScan, setRepositoryScan] = useState<Reply['repositoryScan']>()
    const scanGeneration = useRef(0)
    const importButton = useRef<HTMLButtonElement>(null)
    const cancelImportReview = () => {
        scanGeneration.current++
        setImportFlow(false)
        setRepositoryScan(undefined)
        setImportProgress(undefined)
        setError('')
        requestAnimationFrame(() => importButton.current?.focus())
    }
    const keepEditing = useRef<HTMLButtonElement>(null)
    const previousFocus = useRef<Element | null>(null)
    const templateEditor = useRef<EditorHandle>(null)
    const [templateImagesReady, setTemplateImagesReady] = useState(true)
    const [templateHistory, setTemplateHistory] = useState({ canUndo: false, canRedo: false })
    const templateWords = plainText(settings.template).trim().split(/\s+/).filter(Boolean).length
    const zones = useMemo(() => timezoneOptions(state.settings.timezone), [state.settings.timezone])
    const matchingRepositories = repositories.filter((repository) =>
        `${repository.name} ${repository.path}`.toLowerCase().includes(repositorySearch.trim().toLowerCase())
    )
    const activeImport = state.repositoryImport?.status === 'running' ? state.repositoryImport : undefined
    useEffect(() => window.journal.onRepositoryImportProgress?.(setImportProgress), [])
    useEffect(() => {
        if (!activeImport && !importFlow) setImportProgress(undefined)
    }, [activeImport, importFlow])
    const requestClose = () => {
        if (importFlow && busy !== 'importRepositories') {
            cancelImportReview()
            return
        }
        if (busy) return
        if (hasUnsavedSettings(settings, repositories, state)) setConfirmClose(true)
        else close()
    }
    const invoke = async (command: Command) => {
        const result = await window.journal.invoke(command)
        await run({ type: 'state' })
        return result
    }
    const action = async (name: string, task: () => Promise<void>) => {
        setBusy(name)
        setError('')
        setStatus('')
        try {
            await task()
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setBusy('')
        }
    }
    const editRepository = (repository: Repository, patch: Partial<Repository>) =>
        setRepositories((items) => items.map((item) => (item.id === repository.id ? { ...item, ...patch } : item)))
    const mergeRepositories = useCallback(
        (fresh: Repository[]) =>
            setRepositories((local) =>
                fresh.map((item) => {
                    const edited = local.find((old) => old.id === item.id)
                    if (!edited) return item
                    const before = state.repositories.find((old) => old.id === item.id)
                    return {
                        ...item,
                        ...edited,
                        accountId: item.accountId,
                        providerProjectId: item.providerProjectId,
                        accountGeneration: item.accountGeneration,
                        assignment: item.assignment,
                        path: item.path,
                        available: item.available,
                        branches: item.branches,
                        removed: item.removed !== before?.removed ? item.removed : edited.removed
                    }
                })
            ),
        [state.repositories]
    )
    const notionDestination = useCallback((destination: State['settings']['destination']) => {
        setSettings((current) => ({ ...current, destination }))
    }, [])
    useEffect(() => {
        notionDestination(state.settings.destination)
    }, [state.settings.destination, notionDestination])
    const save = () =>
        action('save', async () => {
            if (!templateImagesReady) throw new Error('Finish or dismiss template image imports before saving.')
            if (!settings.timezone) throw new Error('Choose a timezone before saving.')
            if (repositories.some((repository) => !repository.removed && !repository.base))
                throw new Error('Choose a comparison base for each tracked repository.')
            for (const repository of repositories) await window.journal.invoke({ type: 'repository', repository })
            await invoke({ type: 'settings', settings })
            close()
        })
    useEffect(() => {
        mergeRepositories(state.repositories)
    }, [state.repositories, mergeRepositories])
    const repositoryFields = (repository: Repository) => (
        <div className="settings-fields settings-repository-fields">
            <div className="settings-actions settings-repository-actions">
                <Switch
                    label="Track this repository"
                    checked={!repository.removed}
                    disabled={!!busy}
                    onCheckedChange={(checked) => editRepository(repository, { removed: !checked })}
                />
                <Button
                    className="settings-locate-button"
                    variant="secondary"
                    size="sm"
                    disabled={!!busy}
                    loading={busy === `locate:${repository.id}`}
                    onClick={() =>
                        action(`locate:${repository.id}`, async () => {
                            const result = await invoke({ type: 'relocate', id: repository.id })
                            mergeRepositories(result.state.repositories)
                        })
                    }
                >
                    <Folder size={16} aria-hidden="true" /> Locate folder
                </Button>
            </div>
            {!repository.available && (
                <p className="settings-hint">Folder unavailable. Locate it to resume tracking.</p>
            )}
            <div className="settings-field-grid">
                <DatePicker
                    label="History starts"
                    value={dateValue(repository.trackingStart)}
                    showToday
                    onChange={(date) => date && editRepository(repository, { trackingStart: dateKey(date) })}
                />
                <Select
                    label="Comparison base"
                    value={repository.base || '__choose__'}
                    placeholder="Choose a branch"
                    options={[
                        ...new Set([
                            repository.base,
                            ...repository.branches,
                            ...(state.repositories.find((item) => item.id === repository.id)?.branches ?? [])
                        ])
                    ]
                        .filter(Boolean)
                        .map((value) => ({ value, label: value }))}
                    onValueChange={(base) => editRepository(repository, { base })}
                />
            </div>
            <Button
                className="settings-backfill"
                contentLayout="stack"
                variant="ghost"
                size="sm"
                disabled={!!busy || repository.removed}
                onClick={() =>
                    action('backfill', async () => {
                        const result = await invoke({
                            type: 'backfill',
                            repositoryId: repository.id,
                            since: dateKey(dateValue(repository.trackingStart))
                        })
                        setStatus(result.message ?? 'Older activity is being acquired. You can close Settings.')
                    })
                }
            >
                <span className="settings-backfill-label">
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>Fetch activity from this date</span>
                </span>
            </Button>
            {providerRemote(repository.remote) && (
                <div className="settings-provider-assignment">
                    <Select
                        label="Account"
                        disabled={
                            !!busy ||
                            repository.remote !== state.repositories.find((r) => r.id === repository.id)?.remote
                        }
                        value={repository.accountId ?? 'automatic'}
                        onValueChange={(id) =>
                            action('assign', async () => {
                                const result = await invoke({
                                    type: 'providerAssign',
                                    repositoryId: repository.id,
                                    automatic: id === 'automatic',
                                    accountId: id === 'automatic' ? undefined : id
                                })
                                mergeRepositories(result.state.repositories)
                                setStatus(
                                    result.state.repositories.find((r) => r.id === repository.id)?.accountId
                                        ? 'Account selected.'
                                        : 'Choose an account to refresh this repository.'
                                )
                            })
                        }
                        options={[
                            { value: 'automatic', label: 'Automatic matching' },
                            ...state.accounts
                                .filter((a) => a.provider === providerRemote(repository.remote)?.provider)
                                .map((a) => ({
                                    value: a.id,
                                    label: `@${a.username}${a.status === 'disconnected' || a.status === 'reconnect' ? ' (reconnect)' : ''}`
                                }))
                        ]}
                    />
                    <p className="settings-hint">
                        {repository.accountId
                            ? `${repository.assignment === 'explicit' ? 'Selected' : 'Automatically matched'} account. Local author email filters stay unchanged.`
                            : 'Choose an account if more than one can access this repository. Local Git tracking continues.'}
                    </p>
                </div>
            )}
            <Select
                label="Remote"
                value={repository.remote || '__local__'}
                options={[
                    { value: '__local__', label: 'Local only' },
                    ...[...new Set([...(remotes[repository.id] ?? []), repository.remote])]
                        .filter(Boolean)
                        .map((value) => ({ value, label: value }))
                ]}
                onValueChange={(remote) => editRepository(repository, { remote: remote === '__local__' ? '' : remote })}
            />
            <TagInput
                label="Author emails"
                placeholder="Add an author email"
                value={repository.emails.filter(Boolean)}
                onValueChange={(emails) => editRepository(repository, { emails })}
                description="Press Enter or comma to add each author email."
            />
        </div>
    )
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) requestClose()
            }}
        >
            <DialogContent
                className="settings"
                backdrop="dim"
                title={importFlow ? 'Import repositories' : 'Workspace settings'}
                aria-describedby={undefined}
                onOpenAutoFocus={() => {
                    previousFocus.current = document.activeElement
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected)
                        previousFocus.current.focus()
                    else
                        document
                            .querySelector<HTMLButtonElement>('.hub-setup-trigger, [aria-label="Open settings"]')
                            ?.focus()
                }}
            >
                {importFlow ? (
                    <RepositoryImportReview
                        scan={repositoryScan}
                        progress={importProgress}
                        busy={busy === 'importRepositories'}
                        error={error}
                        cancel={cancelImportReview}
                        confirm={(paths) =>
                            action('importRepositories', async () => {
                                if (!repositoryScan) return
                                const result = await invoke({
                                    type: 'importRepositories',
                                    scanId: repositoryScan.id,
                                    paths
                                })
                                mergeRepositories(result.state.repositories)
                                cancelImportReview()
                            })
                        }
                    />
                ) : (
                    <>
                        <Tabs
                            value={section}
                            onValueChange={setSection}
                            orientation={compact ? 'horizontal' : 'vertical'}
                            className="settings-tabs"
                        >
                            <ScrollArea
                                className="settings-navigation"
                                orientation={compact ? 'horizontal' : 'vertical'}
                                fade={12}
                                label="Settings navigation"
                            >
                                <TabsList aria-label="Settings sections">
                                    {['repositories', 'connections', 'preferences', 'template', 'backup'].map((tab) => (
                                        <TabsTrigger key={tab} value={tab}>
                                            {tab[0].toUpperCase() + tab.slice(1)}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </ScrollArea>
                            <ScrollArea
                                className="settings-scroll"
                                viewportClassName="settings-viewport"
                                label="Settings content"
                                fade={16}
                            >
                                <TabsContent value="repositories" className="settings-content">
                                    <div className="settings-section-heading">
                                        <h3>Repositories</h3>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            className="settings-import-button"
                                            ref={importButton}
                                            contentLayout="stack"
                                            disabled={!!busy || !!activeImport}
                                            aria-busy={busy === 'repositories' || !!activeImport || undefined}
                                            onClick={() =>
                                                action('repositories', async () => {
                                                    const generation = ++scanGeneration.current
                                                    setRepositoryScan(undefined)
                                                    setImportFlow(true)
                                                    setImportProgress({ stage: 'selecting' })
                                                    try {
                                                        const result = await invoke({ type: 'addRepositories' })
                                                        if (generation !== scanGeneration.current) return
                                                        if (result.repositoryScan)
                                                            setRepositoryScan(result.repositoryScan)
                                                        else cancelImportReview()
                                                    } catch (failure) {
                                                        if (generation === scanGeneration.current) throw failure
                                                    } finally {
                                                        setImportProgress(undefined)
                                                    }
                                                })
                                            }
                                        >
                                            <ImportProgressLabel
                                                progress={importProgress}
                                                activeImport={activeImport}
                                            />
                                        </Button>
                                    </div>
                                    {!repositories.length && (
                                        <p className="settings-hint">
                                            Choose the folder containing your Git repositories.
                                        </p>
                                    )}
                                    {!!repositories.length && (
                                        <SearchField
                                            label="Search repositories"
                                            hideLabel
                                            placeholder="Repository name or folder path"
                                            value={repositorySearch}
                                            onValueChange={setRepositorySearch}
                                        />
                                    )}
                                    {!!repositories.length && !matchingRepositories.length && (
                                        <p className="settings-hint" role="status">
                                            No matching repositories.
                                        </p>
                                    )}
                                    {!!matchingRepositories.length && (
                                        <div className="settings-repositories">
                                            {matchingRepositories.map((repository) => (
                                                <ExpandableCard
                                                    key={repository.id}
                                                    title={repository.name}
                                                    description={repository.path || 'Folder not located'}
                                                >
                                                    {() => repositoryFields(repository)}
                                                </ExpandableCard>
                                            ))}
                                        </div>
                                    )}
                                </TabsContent>
                                <TabsContent value="connections" className="settings-content">
                                    <ProviderConnections state={state} refresh={run} />
                                    <section className="settings-section" aria-label="Notion connection">
                                        <div className="settings-section-heading settings-github-heading">
                                            <h3 className="settings-connection-title">
                                                <span className="settings-connection-logo settings-connection-logo--notion">
                                                    <NotionLogoIcon
                                                        size={24}
                                                        weight="fill"
                                                        aria-hidden="true"
                                                        focusable="false"
                                                    />
                                                </span>
                                                Notion
                                            </h3>
                                            <div className="settings-github-controls">
                                                <NotionSignIn
                                                    connected={connections.notion}
                                                    destination={settings.destination}
                                                    disabled={!!busy}
                                                    run={run}
                                                    onDestination={notionDestination}
                                                />
                                            </div>
                                        </div>
                                        {(connections.remote || connections.notion) &&
                                            !connections.protectedStorage && (
                                                <p className="settings-hint">
                                                    Credentials are kept for this session only.
                                                </p>
                                            )}
                                    </section>
                                </TabsContent>
                                <TabsContent value="preferences" className="settings-content">
                                    <section className="settings-section" aria-label="Time and refresh">
                                        <h3>Time and refresh</h3>
                                        <Combobox
                                            label="Timezone"
                                            options={zones}
                                            value={settings.timezone}
                                            onValueChange={(timezone) => setSettings({ ...settings, timezone })}
                                            placeholder="Search timezones"
                                        />
                                        <div className="settings-field-grid">
                                            <Select
                                                label="Week starts"
                                                value={String(settings.weekStart)}
                                                options={[
                                                    'Sunday',
                                                    'Monday',
                                                    'Tuesday',
                                                    'Wednesday',
                                                    'Thursday',
                                                    'Friday',
                                                    'Saturday'
                                                ].map((label, index) => ({ value: String(index), label }))}
                                                onValueChange={(value) =>
                                                    setSettings({ ...settings, weekStart: Number(value) })
                                                }
                                            />
                                            <NumberField
                                                label="Refresh interval"
                                                min={0}
                                                max={1440}
                                                value={settings.refreshMinutes}
                                                onValueChange={(refreshMinutes) =>
                                                    setSettings({ ...settings, refreshMinutes })
                                                }
                                                suffix={(minutes) => (minutes === 1 ? ' minute' : ' minutes')}
                                                description="Set to 0 to turn off background refresh."
                                            />
                                        </div>
                                    </section>
                                </TabsContent>
                                <TabsContent value="template" className="settings-content">
                                    <section className="settings-section" aria-label="Entry template">
                                        <div className="settings-section-heading">
                                            <h3>Entry template</h3>
                                        </div>
                                        <p className="settings-hint">
                                            Used for new entries. Existing writing stays as it is.
                                        </p>
                                        <div className="settings-template">
                                            <header className="settings-template-header">
                                                <div className="settings-template-history">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-label="Undo template edit"
                                                        disabled={!templateHistory.canUndo}
                                                        onClick={() => templateEditor.current?.undo()}
                                                    >
                                                        <ArrowCounterClockwiseIcon aria-hidden="true" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-label="Redo template edit"
                                                        disabled={!templateHistory.canRedo}
                                                        onClick={() => templateEditor.current?.redo()}
                                                    >
                                                        <ArrowClockwiseIcon aria-hidden="true" />
                                                    </Button>
                                                </div>
                                                <span>
                                                    {templateWords} {templateWords === 1 ? 'word' : 'words'}
                                                </span>
                                            </header>
                                            <div className="settings-template-body" data-journal-drop-zone>
                                                <Editor
                                                    restoreId={state.restoreId}
                                                    onImagesReadyChange={setTemplateImagesReady}
                                                    ref={templateEditor}
                                                    onHistoryChange={setTemplateHistory}
                                                    label="Entry template"
                                                    value={settings.template}
                                                    onChange={(template) =>
                                                        setSettings((current) => ({ ...current, template }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </section>
                                </TabsContent>
                                <TabsContent value="backup" className="settings-content">
                                    <section className="settings-section" aria-label="Journal backup">
                                        <h3>Journal backup</h3>
                                        <p className="settings-hint">
                                            Includes writing, images, and tracking. Excludes credentials and repository
                                            files.
                                        </p>
                                        <div className="settings-actions">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!!busy}
                                                loading={busy === 'export'}
                                                onClick={() =>
                                                    action('export', async () => {
                                                        await invoke({ type: 'export' })
                                                    })
                                                }
                                            >
                                                Export backup
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={!!busy}
                                                loading={busy === 'import'}
                                                onClick={() =>
                                                    action('import', async () => {
                                                        const result = await invoke({ type: 'import' })
                                                        if (result.message === 'Backup imported.') {
                                                            setSettings(result.state.settings)
                                                            setRepositories(result.state.repositories)
                                                            setStatus(result.message)
                                                        }
                                                    })
                                                }
                                            >
                                                Import backup
                                            </Button>
                                        </div>
                                        <p className="settings-hint">Import replaces this device’s journal.</p>
                                    </section>
                                </TabsContent>
                            </ScrollArea>
                        </Tabs>
                        <footer className="settings-footer">
                            <div className="settings-feedback">
                                {error ? (
                                    <Alert tone="danger" title="Settings could not be updated">
                                        {error}
                                    </Alert>
                                ) : (
                                    <p role="status">{status || 'Changes apply when saved.'}</p>
                                )}
                            </div>
                            <Button disabled={!!busy} loading={busy === 'save'} onClick={save}>
                                Save settings
                            </Button>
                        </footer>
                    </>
                )}
            </DialogContent>
            <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
                <DialogContent
                    role="alertdialog"
                    title="Discard unsaved changes?"
                    description="Your settings changes will be lost."
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        keepEditing.current?.focus()
                    }}
                >
                    <div className="settings-discard-actions">
                        <Button ref={keepEditing} variant="secondary" onClick={() => setConfirmClose(false)}>
                            Keep editing
                        </Button>
                        <Button variant="danger" onClick={close}>
                            Discard changes
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Dialog>
    )
}
