import { Disclosure } from './components/Disclosure'
import { ImportResults } from './ImportResults'
import { Alert } from './components/arc/alert/alert'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plainText } from '../shared/notion-format'
import type { Command, Destination, Reply, Repository, RepositoryImportProgress, State } from '../shared/model'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'
import { Select } from './components/arc/select/select'
import { Combobox } from './components/arc/combobox/combobox'
import { DatePicker } from './components/arc/date-picker/date-picker'
import { RepositoryEmails } from './RepositoryEmails'
import { ImportProgressLabel } from './ImportProgressLabel'
import { Folder, RefreshCw } from 'lucide-react'
import { Switch } from './components/arc/switch/switch'
import { ExpandableCard } from './components/arc/expandable-card/expandable-card'
import { NumberField } from './components/arc/number-field/number-field'
import { SearchField } from './components/arc/search-field/search-field'
import { ConfirmMorph } from './components/arc/confirm-morph/confirm-morph'
import { RichTextEditor, type RichTextEditorHandle } from './components/arc/rich-text-editor/rich-text-editor'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { Editor } from './Editor'
import { dateKey, dateValue, journalFromHTML, journalHTML, needsLegacyEditor } from './workspace-model'
import { hasUnsavedSettings, timezoneOptions } from './settings-model'
import './settings.css'

export function Settings({
    state,
    connections,
    remotes,
    run,
    close
}: {
    state: State
    connections: Reply['connections']
    remotes: Record<string, string[]>
    run: (command: Command) => Promise<Reply | undefined>
    close: () => void
}) {
    const [settings, setSettings] = useState(state.settings)
    const [repositories, setRepositories] = useState(state.repositories)
    const [token, setToken] = useState('')
    const [device, setDevice] = useState<Reply['device']>()
    const [error, setError] = useState('')
    const [status, setStatus] = useState('')
    const [busy, setBusy] = useState('')
    const [section, setSection] = useState('repositories')
    const [confirmClose, setConfirmClose] = useState(false)
    const [repositorySearch, setRepositorySearch] = useState('')
    const [importProgress, setImportProgress] = useState<RepositoryImportProgress>()
    const keepEditing = useRef<HTMLButtonElement>(null)
    const previousFocus = useRef<Element | null>(null)
    const templateEditor = useRef<RichTextEditorHandle>(null)
    const [templateHistory, setTemplateHistory] = useState({ canUndo: false, canRedo: false })
    const templateWords = plainText(settings.template).trim().split(/\s+/).filter(Boolean).length
    const zones = useMemo(() => timezoneOptions(state.settings.timezone), [state.settings.timezone])
    const matchingRepositories = repositories.filter((repository) =>
        `${repository.name} ${repository.path}`.toLowerCase().includes(repositorySearch.trim().toLowerCase())
    )
    const activeImport = state.repositoryImport?.status === 'running' ? state.repositoryImport : undefined
    useEffect(() => window.journal.onRepositoryImportProgress?.(setImportProgress), [])
    const requestClose = () => {
        if (busy) return
        if (hasUnsavedSettings(settings, repositories, state, token)) setConfirmClose(true)
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
                        path: item.path,
                        available: item.available,
                        branches: item.branches,
                        removed: item.removed !== before?.removed ? item.removed : edited.removed
                    }
                })
            ),
        [state.repositories]
    )
    const destination = (patch: Partial<Destination>) =>
        setSettings((current) => ({
            ...current,
            destination: {
                kind: 'page',
                id: '',
                titleProperty: 'Name',
                dateProperty: '',
                ...current.destination,
                ...patch
            }
        }))
    useEffect(() => {
        if (!device) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const result = await window.journal.invoke({ type: 'githubPoll' })
                if (cancelled) return
                if (result.devicePending) timer = setTimeout(() => void poll(), result.devicePending.interval * 1000)
                else {
                    setDevice(undefined)
                    setSettings((current) => ({ ...current, githubLogin: result.state.settings.githubLogin }))
                    setRepositories((local) =>
                        result.state.repositories.map((item) => {
                            const edited = local.find((old) => old.id === item.id)
                            return edited
                                ? { ...item, ...edited, emails: [...new Set([...item.emails, ...edited.emails])] }
                                : item
                        })
                    )
                    setStatus(`Connected as ${result.state.settings.githubLogin}`)
                    await run({ type: 'state' })
                }
            } catch (failure) {
                if (!cancelled) {
                    setError(failure instanceof Error ? failure.message : String(failure))
                    setDevice(undefined)
                    setStatus('')
                }
            }
        }
        timer = setTimeout(() => void poll(), device.interval * 1000)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [device, run])
    const save = () =>
        action('save', async () => {
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
    const startSignIn = () =>
        action('github', async () => {
            if (!settings.githubClientId.trim())
                throw new Error('Enter a GitHub OAuth client ID with device flow enabled.')
            await window.journal.invoke({
                type: 'settings',
                settings: { ...state.settings, githubClientId: settings.githubClientId.trim() }
            })
            const result = await invoke({ type: 'githubStart' })
            setDevice(result.device)
            setStatus(result.message ?? 'Waiting for your browser…')
        })
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
            <Select
                label="GitHub remote"
                value={repository.remote || '__local__'}
                options={[
                    { value: '__local__', label: 'Local only' },
                    ...[...new Set([...(remotes[repository.id] ?? []), repository.remote])]
                        .filter(Boolean)
                        .map((value) => ({ value, label: value }))
                ]}
                onValueChange={(remote) => editRepository(repository, { remote: remote === '__local__' ? '' : remote })}
            />
            <RepositoryEmails
                value={repository.emails}
                suggestions={state.repositories.find((item) => item.id === repository.id)?.emails ?? []}
                onChange={(emails) => editRepository(repository, { emails })}
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
                title="Workspace settings"
                aria-describedby={undefined}
                onOpenAutoFocus={() => {
                    previousFocus.current = document.activeElement
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus()
                }}
            >
                <Tabs value={section} onValueChange={setSection} orientation="vertical" className="settings-tabs">
                    <ScrollArea className="settings-navigation" fade={12} label="Settings navigation">
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
                                    contentLayout="stack"
                                    disabled={!!busy || !!activeImport}
                                    aria-busy={busy === 'repositories' || !!activeImport || undefined}
                                    onClick={() =>
                                        action('repositories', async () => {
                                            setImportProgress({ stage: 'selecting' })
                                            try {
                                                const result = await invoke({ type: 'addRepositories' })
                                                mergeRepositories(result.state.repositories)
                                                setStatus('')
                                            } finally {
                                                setImportProgress(undefined)
                                            }
                                        })
                                    }
                                >
                                    <ImportProgressLabel progress={importProgress} activeImport={activeImport} />
                                </Button>
                            </div>
                            {state.repositoryImport?.status !== 'running' && state.repositoryImport?.message && (
                                <Disclosure title="Last import results" className="settings-hint">
                                    <ImportResults job={state.repositoryImport} />
                                </Disclosure>
                            )}
                            {!repositories.length && (
                                <p className="settings-hint">Choose the folder containing your Git repositories.</p>
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
                            <section className="settings-section" aria-label="GitHub connection">
                                <div className="settings-section-heading">
                                    <h3>GitHub</h3>
                                    {connections.github ? (
                                        <div className="settings-github-account">
                                            <span className="settings-github-identity">
                                                {settings.githubLogin && (
                                                    <span className="settings-github-avatar" aria-hidden="true">
                                                        {settings.githubLogin.slice(0, 1).toUpperCase()}
                                                        <img
                                                            src={`https://github.com/${encodeURIComponent(settings.githubLogin)}.png?size=64`}
                                                            width={32}
                                                            height={32}
                                                            alt=""
                                                            onError={(event) => {
                                                                event.currentTarget.hidden = true
                                                            }}
                                                        />
                                                    </span>
                                                )}
                                                <span>{settings.githubLogin || 'Connected'}</span>
                                            </span>
                                            <ConfirmMorph
                                                label="Disconnect"
                                                prompt={
                                                    <span className="settings-disconnect-question">
                                                        Disconnect GitHub?
                                                    </span>
                                                }
                                                confirmLabel="Disconnect"
                                                confirmMode="hold"
                                                pendingLabel="Disconnecting"
                                                doneLabel="Disconnected"
                                                errorLabel="Could not disconnect"
                                                tone="danger"
                                                disabled={!!busy}
                                                onConfirm={async () => {
                                                    setBusy('disconnect-github')
                                                    setError('')
                                                    try {
                                                        await invoke({ type: 'disconnect', service: 'github' })
                                                        setSettings((current) => ({ ...current, githubLogin: '' }))
                                                        setStatus('GitHub disconnected.')
                                                    } finally {
                                                        setBusy('')
                                                    }
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <span className="settings-connection-status">Not connected</span>
                                    )}
                                </div>
                                {!connections.github && (
                                    <>
                                        <Input
                                            label="OAuth client ID"
                                            value={settings.githubClientId}
                                            onChange={(event) =>
                                                setSettings({ ...settings, githubClientId: event.target.value })
                                            }
                                        />
                                        <div className="settings-actions">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!!busy || !!device}
                                                loading={busy === 'github'}
                                                onClick={startSignIn}
                                            >
                                                Sign in with browser
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={!!busy}
                                                onClick={() =>
                                                    action('oauth', async () => {
                                                        await invoke({
                                                            type: 'open',
                                                            url: 'https://github.com/settings/applications/new'
                                                        })
                                                    })
                                                }
                                            >
                                                Set up OAuth app
                                            </Button>
                                        </div>
                                        <p className="settings-hint">Enable device flow in your GitHub OAuth app.</p>
                                    </>
                                )}
                                {device && (
                                    <div className="settings-device">
                                        <p>
                                            Enter <code>{device.code}</code> in your browser.
                                        </p>
                                        <div className="settings-actions">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!!busy}
                                                onClick={() =>
                                                    action('browser', async () => {
                                                        await invoke({ type: 'open', url: device.url })
                                                    })
                                                }
                                            >
                                                Open browser
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setDevice(undefined)
                                                    setStatus('')
                                                }}
                                            >
                                                Cancel sign-in
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </section>
                            <section className="settings-section" aria-label="Notion connection">
                                <div className="settings-section-heading">
                                    <h3>Notion</h3>
                                    <span className="settings-connection-status">
                                        {connections.notion ? 'Connected' : 'Not connected'}
                                    </span>
                                </div>
                                {!connections.notion ? (
                                    <>
                                        <Input
                                            label="Integration token"
                                            type="password"
                                            autoComplete="off"
                                            value={token}
                                            onChange={(event) => setToken(event.target.value)}
                                        />
                                        <div className="settings-actions">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={!token.trim() || !!busy}
                                                loading={busy === 'notion'}
                                                onClick={() =>
                                                    action('notion', async () => {
                                                        await invoke({ type: 'notionConnect', token: token.trim() })
                                                        setToken('')
                                                        setStatus('Notion connected.')
                                                    })
                                                }
                                            >
                                                Connect Notion
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={!!busy}
                                        onClick={() =>
                                            action('disconnect-notion', async () => {
                                                await invoke({ type: 'disconnect', service: 'notion' })
                                                setStatus('Notion disconnected.')
                                            })
                                        }
                                    >
                                        Disconnect Notion
                                    </Button>
                                )}
                                {(connections.github || connections.notion) && !connections.protectedStorage && (
                                    <p className="settings-hint">Credentials are kept for this session only.</p>
                                )}
                                <div className="settings-field-grid">
                                    <Select
                                        label="Destination"
                                        value={settings.destination?.kind ?? 'page'}
                                        options={[
                                            { value: 'page', label: 'Parent page' },
                                            { value: 'database', label: 'Database data source' }
                                        ]}
                                        onValueChange={(kind) => destination({ kind: kind as Destination['kind'] })}
                                    />
                                    <Input
                                        label={settings.destination?.kind === 'database' ? 'Data source ID' : 'Page ID'}
                                        value={settings.destination?.id ?? ''}
                                        onChange={(event) => destination({ id: event.target.value.trim() })}
                                    />
                                </div>
                                {settings.destination?.kind === 'database' && (
                                    <div className="settings-field-grid">
                                        <Input
                                            label="Title property"
                                            value={settings.destination.titleProperty}
                                            onChange={(event) => destination({ titleProperty: event.target.value })}
                                        />
                                        <Input
                                            label="Date property (optional)"
                                            value={settings.destination.dateProperty}
                                            onChange={(event) => destination({ dateProperty: event.target.value })}
                                        />
                                    </div>
                                )}
                                <p className="settings-hint">Share the destination with your Notion integration.</p>
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
                                        onValueChange={(refreshMinutes) => setSettings({ ...settings, refreshMinutes })}
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
                                <p className="settings-hint">Used for new entries. Existing writing stays as it is.</p>
                                <div className="settings-template">
                                    <header className="settings-template-header">
                                        <div className="settings-template-history">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                aria-label="Undo template edit"
                                                disabled={
                                                    !templateHistory.canUndo || needsLegacyEditor(settings.template)
                                                }
                                                onClick={() => templateEditor.current?.undo()}
                                            >
                                                <ArrowCounterClockwiseIcon aria-hidden="true" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                aria-label="Redo template edit"
                                                disabled={
                                                    !templateHistory.canRedo || needsLegacyEditor(settings.template)
                                                }
                                                onClick={() => templateEditor.current?.redo()}
                                            >
                                                <ArrowClockwiseIcon aria-hidden="true" />
                                            </Button>
                                        </div>
                                        <span>
                                            {templateWords} {templateWords === 1 ? 'word' : 'words'}
                                        </span>
                                    </header>
                                    <div className="settings-template-body">
                                        {needsLegacyEditor(settings.template) ? (
                                            <Editor
                                                value={settings.template}
                                                onChange={(template) =>
                                                    setSettings((current) => ({ ...current, template }))
                                                }
                                            />
                                        ) : (
                                            <RichTextEditor
                                                ref={templateEditor}
                                                onHistoryChange={setTemplateHistory}
                                                aria-label="Entry template"
                                                defaultValue={journalHTML(settings.template)}
                                                placeholder="Give each week a starting point…"
                                                blockHint="Type / for formatting"
                                                onChange={({ html }) =>
                                                    setSettings((current) => ({
                                                        ...current,
                                                        template: journalFromHTML(html)
                                                    }))
                                                }
                                            />
                                        )}
                                    </div>
                                </div>
                            </section>
                        </TabsContent>
                        <TabsContent value="backup" className="settings-content">
                            <section className="settings-section" aria-label="Journal backup">
                                <h3>Journal backup</h3>
                                <p className="settings-hint">
                                    Includes writing and tracking. Excludes credentials and repository files.
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
                    <Button disabled={!!busy || !!device} loading={busy === 'save'} onClick={save}>
                        Save settings
                    </Button>
                </footer>
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
