import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'
import { RepositoryScanStatus } from './RepositoryScanStatus'
import type { Reply, RepositoryImportProgress } from '../shared/model'
import { Alert } from './components/arc/alert/alert'
import { Button } from './components/arc/button/button'
import { Checkbox } from './components/arc/checkbox/checkbox'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { SearchField } from './components/arc/search-field/search-field'

export function RepositoryImportReview({
    scan,
    progress,
    busy,
    error,
    cancel,
    confirm
}: {
    scan?: Reply['repositoryScan']
    progress?: RepositoryImportProgress
    busy: boolean
    error: string
    cancel: () => void
    confirm: (paths: string[]) => Promise<void>
}) {
    const [query, setQuery] = useState('')
    const [selection, setSelected] = useState<Set<string>>()
    const heading = useRef<HTMLHeadingElement>(null)
    const reduced = useReducedMotion()
    const outcome = scan ? 'success' : error ? 'error' : 'loading'
    const [showResult, setShowResult] = useState(false)
    useEffect(() => {
        setShowResult(false)
        if (outcome === 'loading') return
        // Let the status mark settle and remain readable before revealing the next screen.
        const timeout = setTimeout(
            () => setShowResult(true),
            (motionTokens.duration.standard + motionTokens.duration.considered) * 1000
        )
        return () => clearTimeout(timeout)
    }, [outcome])
    useEffect(() => {
        heading.current?.focus()
    }, [])
    const eligible = scan?.repositories.filter((item) => item.status !== 'tracked') ?? []
    const selected = selection ?? new Set(eligible.map((item) => item.path))
    const matching =
        scan?.repositories.filter((item) =>
            `${item.name} ${item.relativePath}`.toLowerCase().includes(query.trim().toLowerCase())
        ) ?? []
    return (
        <section className="repository-import-review" aria-busy={outcome === 'loading' || busy || undefined}>
            <header className="repository-import-heading">
                <h3 ref={heading} tabIndex={-1}>
                    {showResult ? (scan ? 'Choose repositories to import' : 'Folder scan failed') : 'Find repositories'}
                </h3>
                {showResult && scan && <p className="settings-hint">{scan.folder}</p>}
            </header>
            <AnimatePresence mode="wait" initial={false}>
                {showResult ? (
                    <motion.div
                        key="results"
                        className="repository-import-results"
                        initial={{ opacity: 0, transform: reduced ? 'none' : 'translateY(4px)' }}
                        animate={{ opacity: 1, transform: reduced ? 'none' : 'translateY(0px)' }}
                        exit={{ opacity: 0 }}
                        transition={{
                            duration: reduced ? 0 : motionTokens.duration.standard,
                            ease: [...motionTokens.ease.enter]
                        }}
                    >
                        {error && (
                            <Alert
                                tone="danger"
                                title={scan ? 'Repositories could not be imported' : 'Folder could not be scanned'}
                            >
                                {scan
                                    ? error
                                    : 'The folder could not be read. Check its location and permissions, then choose it again.'}
                            </Alert>
                        )}
                        {scan && (
                            <>
                                {!!scan.repositories.length && (
                                    <div className="repository-import-tools">
                                        <SearchField
                                            label="Search discovered repositories"
                                            hideLabel
                                            placeholder="Search by name or path"
                                            value={query}
                                            onValueChange={setQuery}
                                        />
                                        <div className="repository-import-bulk">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                disabled={busy || selected.size === eligible.length}
                                                onClick={() => setSelected(new Set(eligible.map((item) => item.path)))}
                                            >
                                                Select all
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={busy || !selected.size}
                                                onClick={() => setSelected(new Set())}
                                            >
                                                Deselect all
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                <ScrollArea
                                    className="repository-import-list"
                                    viewportClassName="repository-import-ledger-viewport"
                                    label="Discovered repositories"
                                    fade={12}
                                >
                                    {!scan.repositories.length ? (
                                        <p className="settings-hint">No Git repositories found. Try another folder.</p>
                                    ) : !matching.length ? (
                                        <p className="settings-hint" role="status">
                                            No repositories match your search.
                                        </p>
                                    ) : (
                                        <ul>
                                            {matching.map((item) => (
                                                <li key={item.path} className="repository-import-row">
                                                    <Checkbox
                                                        label={item.name}
                                                        description={item.relativePath}
                                                        checked={selected.has(item.path)}
                                                        disabled={busy || item.status === 'tracked'}
                                                        onCheckedChange={(checked) =>
                                                            setSelected((current) => {
                                                                const next = new Set(current ?? selected)
                                                                if (checked === true) next.add(item.path)
                                                                else next.delete(item.path)
                                                                return next
                                                            })
                                                        }
                                                    />
                                                    {item.status !== 'new' && (
                                                        <span className="settings-hint">
                                                            {item.status === 'tracked'
                                                                ? 'Already tracked'
                                                                : 'Resume tracking'}
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </ScrollArea>
                                {!!scan.unreadable.length && (
                                    <p className="settings-hint" role="status">
                                        {scan.unreadable.length} folders could not be read. Check their permissions and
                                        scan again to include them.
                                    </p>
                                )}
                            </>
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="status"
                        className="repository-import-wait"
                        initial={false}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{
                            duration: reduced ? 0 : motionTokens.duration.exit,
                            ease: [...motionTokens.ease.standard]
                        }}
                    >
                        <RepositoryScanStatus
                            status={outcome}
                            description={
                                scan
                                    ? scan.repositories.length
                                        ? 'Repositories found'
                                        : 'No Git repositories found'
                                    : error
                                      ? 'Folder scan failed'
                                      : progress?.stage === 'selecting'
                                        ? 'Waiting for folder selection...'
                                        : 'Scanning for repositories...'
                            }
                            detail={
                                scan
                                    ? `${scan.repositories.length} ${scan.repositories.length === 1 ? 'repository' : 'repositories'} ready to review`
                                    : error
                                      ? 'No repositories have been changed.'
                                      : progress?.stage === 'discovering'
                                        ? `${progress.found} repositories found, ${progress.scanned} folders scanned`
                                        : 'Choose the folder containing your Git repositories.'
                            }
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            <footer className="repository-import-footer">
                <p className="settings-hint" role="status">
                    {scan && showResult
                        ? `${selected.size} of ${eligible.length} eligible repositories selected`
                        : 'No repositories have been changed.'}
                </p>
                <div className="repository-import-actions">
                    <Button variant="ghost" disabled={busy} onClick={cancel}>
                        {error && !scan ? 'Back to Settings' : 'Cancel'}
                    </Button>
                    {scan && showResult && (
                        <Button
                            animateContent={false}
                            disabled={busy || !selected.size}
                            aria-busy={busy || undefined}
                            onClick={() => confirm([...selected])}
                        >
                            {busy
                                ? 'Starting import…'
                                : `Import ${selected.size} ${selected.size === 1 ? 'repository' : 'repositories'}`}
                        </Button>
                    )}
                </div>
            </footer>
        </section>
    )
}
