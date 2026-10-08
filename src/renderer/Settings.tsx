import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs'
import { Input, Select, Textarea, Field } from './components/Fields'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { Editor } from './Editor'
import { Button } from './components/arc/button/button'
import type { Command, Reply, Repository, State } from '../shared/model'

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
    const [signInError, setSignInError] = useState('')
    const [signInBusy, setSignInBusy] = useState(false)
    const [signInStatus, setSignInStatus] = useState('')
    const [section, setSection] = useState('repositories')
    const [previousFocus] = useState(() => document.activeElement)
    useEffect(() => {
        if (!device) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const result = await window.journal.invoke({ type: 'githubPoll' })
                if (cancelled) return
                if (result.devicePending) {
                    timer = setTimeout(() => void poll(), result.devicePending.interval * 1000)
                } else {
                    setDevice(undefined)
                    setSettings(result.state.settings)
                    setRepositories(result.state.repositories)
                    setSignInStatus(`Connected as ${result.state.settings.githubLogin}`)
                    await run({ type: 'state' })
                }
            } catch (failure) {
                if (!cancelled) {
                    setSignInError(failure instanceof Error ? failure.message : String(failure))
                    setDevice(undefined)
                    setSignInStatus('')
                }
            }
        }
        timer = setTimeout(() => void poll(), device.interval * 1000)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [device, run])
    const startSignIn = async () => {
        setSignInError('')
        setSignInStatus('')
        setDevice(undefined)
        if (!settings.githubClientId.trim()) {
            setSignInError('Enter a GitHub OAuth client ID with device flow enabled to sign in.')
            return
        }
        setSignInBusy(true)
        try {
            await window.journal.invoke({
                type: 'settings',
                settings: { ...settings, githubClientId: settings.githubClientId.trim() }
            })
            const result = await window.journal.invoke({ type: 'githubStart' })
            setDevice(result.device)
            setSignInStatus(result.message ?? 'Waiting for authorization in your browser…')
            await run({ type: 'state' })
        } catch (failure) {
            setSignInError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setSignInBusy(false)
        }
    }
    const editRepository = (repository: Repository, patch: Partial<Repository>) => {
        setRepositories((items) => items.map((item) => (item.id === repository.id ? { ...item, ...patch } : item)))
    }
    const save = async () => {
        for (const repository of repositories) if (!(await run({ type: 'repository', repository }))) return
        if (await run({ type: 'settings', settings })) close()
    }
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) close()
            }}
        >
            <DialogContent
                className="settings"
                title="Workspace settings"
                aria-describedby={undefined}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (previousFocus instanceof HTMLElement) previousFocus.focus()
                }}
            >
                <Tabs value={section} onValueChange={setSection} orientation="vertical" className="settings-tabs">
                    <TabsList aria-label="Settings sections">
                        {['repositories', 'connections', 'preferences', 'template', 'backup'].map((tab) => (
                            <TabsTrigger key={tab} value={tab}>
                                {tab[0].toUpperCase() + tab.slice(1)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <TabsContent value="repositories" className="settings-content">
                        <>
                            <p className="muted">
                                Choose existing folders. weekly-j never fetches, checks out, or changes your
                                repositories.
                            </p>
                            <Button
                                onClick={async () => {
                                    const result = await run({ type: 'addRepository' })
                                    if (result) {
                                        setRepositories(result.state.repositories)
                                        await run({ type: 'state' })
                                    }
                                }}
                            >
                                Add repository
                            </Button>
                            {repositories.map((repository) => (
                                <fieldset key={repository.id}>
                                    <legend>
                                        {repository.name} {!repository.available && '· Source unavailable'}
                                    </legend>
                                    <p className="path">
                                        {repository.path || 'Locate this repository after restoring'}
                                    </p>
                                    <Field>
                                        Confirmed GitHub remote{' '}
                                        <Select
                                            value={repository.remote}
                                            onChange={(event) => {
                                                editRepository(repository, { remote: event.target.value })
                                            }}
                                        >
                                            <option value="">Local only</option>
                                            {[
                                                ...new Set([
                                                    ...(remotes[repository.id] ?? []),
                                                    ...(repository.remote ? [repository.remote] : [])
                                                ])
                                            ].map((remote) => (
                                                <option key={remote}>{remote}</option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field>
                                        Author emails (comma separated)
                                        <Input
                                            value={repository.emails.join(', ')}
                                            onChange={(event) => {
                                                editRepository(repository, {
                                                    emails: event.target.value.split(',').map((email) => email.trim())
                                                })
                                            }}
                                        />
                                    </Field>
                                    <div className="row">
                                        <Field>
                                            Activity history starts
                                            <Input
                                                type="date"
                                                value={repository.trackingStart}
                                                onChange={(event) => {
                                                    editRepository(repository, { trackingStart: event.target.value })
                                                }}
                                            />
                                        </Field>
                                        <Field>
                                            Comparison base
                                            <Input
                                                value={repository.base}
                                                onChange={(event) => {
                                                    editRepository(repository, { base: event.target.value })
                                                }}
                                            />
                                        </Field>
                                    </div>
                                    <Field>
                                        Branch comparison overrides (one branch=base per line)
                                        <Textarea
                                            value={Object.entries(repository.branchBases)
                                                .map(([branch, base]) => `${branch}=${base}`)
                                                .join('\n')}
                                            onChange={(event) => {
                                                editRepository(repository, {
                                                    branchBases: Object.fromEntries(
                                                        event.target.value
                                                            .split('\n')
                                                            .filter((line) => line.includes('='))
                                                            .map((line) => line.split('=').map((value) => value.trim()))
                                                    )
                                                })
                                            }}
                                        />
                                    </Field>
                                    <div className="row">
                                        <Button
                                            variant="secondary"
                                            onClick={async () => {
                                                const result = await run({ type: 'relocate', id: repository.id })
                                                if (result) setRepositories(result.state.repositories)
                                            }}
                                        >
                                            Locate folder
                                        </Button>
                                        <Field className="row">
                                            <Input
                                                type="checkbox"
                                                checked={repository.removed}
                                                onChange={(event) => {
                                                    editRepository(repository, { removed: event.target.checked })
                                                }}
                                            />
                                            Stop tracking; keep history
                                        </Field>
                                    </div>
                                </fieldset>
                            ))}
                        </>
                    </TabsContent>
                    <TabsContent value="connections" className="settings-content">
                        <>
                            <fieldset>
                                <legend>GitHub · {connections.github ? 'Connected' : 'Disconnected'}</legend>
                                <Field>
                                    Public OAuth client ID
                                    <Input
                                        value={settings.githubClientId}
                                        onChange={(event) => {
                                            setSettings({ ...settings, githubClientId: event.target.value })
                                        }}
                                    />
                                </Field>
                                <p className="muted">
                                    Register a GitHub OAuth app, enable device flow, then paste its Client ID above. No
                                    client secret is needed. This build does not include a registered client ID.
                                </p>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        run({ type: 'open', url: 'https://github.com/settings/applications/new' })
                                    }
                                >
                                    Set up GitHub OAuth app ↗
                                </Button>
                                <div className="row">
                                    <Button
                                        loading={signInBusy}
                                        disabled={signInBusy || !!device}
                                        onClick={startSignIn}
                                    >
                                        Sign in with browser
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            setDevice(undefined)
                                            setSignInStatus('')
                                            void run({ type: 'disconnect', service: 'github' })
                                        }}
                                    >
                                        Disconnect
                                    </Button>
                                </div>
                                {signInError && (
                                    <p className="save-warning" role="alert">
                                        {signInError}
                                    </p>
                                )}
                                {signInStatus && <p role="status">{signInStatus}</p>}
                                {device && (
                                    <div>
                                        <p>
                                            Enter <strong>{device.code}</strong> in the opened browser.
                                        </p>
                                        <p className="path">{device.url}</p>
                                        <Button
                                            variant="secondary"
                                            onClick={() => run({ type: 'open', url: device.url })}
                                        >
                                            Open browser
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                setDevice(undefined)
                                                setSignInStatus('')
                                            }}
                                        >
                                            Cancel sign-in
                                        </Button>
                                    </div>
                                )}
                            </fieldset>
                            <fieldset>
                                <legend>Notion · {connections.notion ? 'Connected' : 'Disconnected'}</legend>
                                <Field>
                                    Notion token
                                    <Input
                                        type="password"
                                        autoComplete="off"
                                        value={token}
                                        onChange={(event) => {
                                            setToken(event.target.value)
                                        }}
                                    />
                                </Field>
                                <div className="row">
                                    <Button
                                        onClick={async () => {
                                            const result = await run({ type: 'notionConnect', token })
                                            if (result) setToken('')
                                        }}
                                    >
                                        Connect Notion
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() => run({ type: 'disconnect', service: 'notion' })}
                                    >
                                        Disconnect
                                    </Button>
                                </div>
                                {!connections.protectedStorage && (
                                    <p>
                                        Credentials are held for this session because protected OS storage is
                                        unavailable.
                                    </p>
                                )}
                                <Field>
                                    Journal destination
                                    <Select
                                        value={settings.destination?.kind ?? 'page'}
                                        onChange={(event) => {
                                            setSettings({
                                                ...settings,
                                                destination: {
                                                    kind: event.target.value as 'page' | 'database',
                                                    id: settings.destination?.id ?? '',
                                                    titleProperty: settings.destination?.titleProperty ?? 'Name',
                                                    dateProperty: settings.destination?.dateProperty ?? ''
                                                }
                                            })
                                        }}
                                    >
                                        <option value="page">Parent page</option>
                                        <option value="database">Database data source</option>
                                    </Select>
                                </Field>
                                <Field>
                                    {settings.destination?.kind === 'database' ? 'Data source ID' : 'Parent page ID'}
                                    <Input
                                        value={settings.destination?.id ?? ''}
                                        onChange={(event) => {
                                            setSettings({
                                                ...settings,
                                                destination: {
                                                    kind: settings.destination?.kind ?? 'page',
                                                    id: event.target.value.trim(),
                                                    titleProperty: settings.destination?.titleProperty ?? 'Name',
                                                    dateProperty: settings.destination?.dateProperty ?? ''
                                                }
                                            })
                                        }}
                                    />
                                </Field>
                                {settings.destination?.kind === 'database' && (
                                    <>
                                        <Field>
                                            Title property
                                            <Input
                                                value={settings.destination.titleProperty}
                                                onChange={(event) => {
                                                    setSettings({
                                                        ...settings,
                                                        destination: {
                                                            ...settings.destination!,
                                                            titleProperty: event.target.value
                                                        }
                                                    })
                                                }}
                                            />
                                        </Field>
                                        <Field>
                                            Week date property (optional)
                                            <Input
                                                value={settings.destination.dateProperty}
                                                onChange={(event) => {
                                                    setSettings({
                                                        ...settings,
                                                        destination: {
                                                            ...settings.destination!,
                                                            dateProperty: event.target.value
                                                        }
                                                    })
                                                }}
                                            />
                                        </Field>
                                    </>
                                )}
                                <p className="muted">
                                    Share the destination with your Notion connection. New pages go directly under the
                                    parent; arrange year toggles in Notion.
                                </p>
                            </fieldset>
                        </>
                    </TabsContent>
                    <TabsContent value="preferences" className="settings-content">
                        <fieldset>
                            <legend>Time and refresh</legend>
                            <Field>
                                Week starts
                                <Select
                                    value={settings.weekStart}
                                    onChange={(event) => {
                                        setSettings({ ...settings, weekStart: Number(event.target.value) })
                                    }}
                                >
                                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                                        (day, index) => (
                                            <option key={day} value={index}>
                                                {day}
                                            </option>
                                        )
                                    )}
                                </Select>
                            </Field>
                            <Field>
                                Timezone
                                <Input
                                    value={settings.timezone}
                                    onChange={(event) => {
                                        setSettings({ ...settings, timezone: event.target.value })
                                    }}
                                />
                            </Field>
                            <Field>
                                Background refresh interval (minutes; 0 disables)
                                <Input
                                    type="number"
                                    min="0"
                                    max="1440"
                                    value={settings.refreshMinutes}
                                    onChange={(event) => {
                                        setSettings({ ...settings, refreshMinutes: Number(event.target.value) })
                                    }}
                                />
                            </Field>
                        </fieldset>
                    </TabsContent>
                    <TabsContent value="template" className="settings-content">
                        <>
                            <p className="muted">New drafts copy this template. Existing drafts keep their content.</p>
                            <Editor
                                value={settings.template}
                                onChange={(body) => {
                                    setSettings((current) => ({ ...current, template: body }))
                                }}
                            />
                        </>
                    </TabsContent>
                    <TabsContent value="backup" className="settings-content">
                        <>
                            <p>
                                Back up tracking, drafts, settings and cached journal text. Credentials and repository
                                contents are excluded. Import replaces local tracking; reconnect services and locate
                                your repositories afterward.
                            </p>
                            <div className="row">
                                <Button onClick={() => run({ type: 'export' })}>Export backup</Button>
                                <Button variant="secondary" onClick={() => run({ type: 'import' })}>
                                    Import backup
                                </Button>
                            </div>
                        </>
                    </TabsContent>
                </Tabs>
                <footer className="row between">
                    <span className="muted">Changes apply when saved.</span>
                    <Button onClick={save}>Save settings</Button>
                </footer>
            </DialogContent>
        </Dialog>
    )
}
