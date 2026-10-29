import { CircleAlert } from 'lucide-react'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { Button } from './components/arc/button/button'
import { Accordion } from './components/arc/accordion/accordion'
import { CopyButton } from './components/arc/copy-button/copy-button'
import { Skeleton } from './components/arc/skeleton/skeleton'

export function StartupRecovery({
    error,
    pending,
    failures,
    onRetry
}: {
    error: string
    pending: boolean
    failures: number
    onRetry: () => Promise<unknown>
}) {
    if (!error)
        return (
            <main className="loading">
                <div className="startup-loading-content">
                    <h1>Opening your journal</h1>
                    <Skeleton lines={4} label="Loading your journal" />
                </div>
            </main>
        )
    return (
        <main className="startup-recovery" aria-label="Journal recovery">
            <div className="startup-recovery-content">
                <EmptyState
                    icon={<CircleAlert size={28} strokeWidth={1.5} />}
                    iconVariant="plain"
                    title="Couldn't open your journal"
                    description="Gitorian couldn't load your journal. Try again."
                    action={
                        <Button
                            className="startup-retry"
                            animateContent={false}
                            aria-disabled={pending}
                            aria-busy={pending}
                            onClick={() => {
                                if (!pending) void onRetry()
                            }}
                        >
                            {pending ? 'Retrying…' : 'Retry'}
                        </Button>
                    }
                />
                <p className="sr-only" role="status" aria-atomic="true">
                    <span key={`${failures}:${pending}`}>
                        {pending
                            ? 'Retrying…'
                            : failures > 1
                              ? "Still couldn't open your journal. Try again or view technical details."
                              : "Couldn't open your journal. Try again."}
                    </span>
                </p>
                <Accordion
                    defaultOpen={-1}
                    instant
                    variant="plain"
                    items={[
                        {
                            title: 'Technical details',
                            content: (
                                <div className="startup-diagnostics-block">
                                    <div className="startup-diagnostics-toolbar">
                                        <span>Error details</span>
                                        <CopyButton value={error} label="Copy details" variant="plain" />
                                    </div>
                                    <pre className="startup-diagnostics" role="region" aria-label="Error details">
                                        <code>{error}</code>
                                    </pre>
                                </div>
                            )
                        }
                    ]}
                />
            </div>
        </main>
    )
}
