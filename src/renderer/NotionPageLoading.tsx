import { LoaderCircle } from 'lucide-react'
import { Skeleton } from './components/arc/skeleton/skeleton'

export function NotionPageSpinner({ waiting = false }: { waiting?: boolean }) {
    const label = waiting ? 'Waiting for Notion' : 'Loading pages'
    return (
        <span role="status" title={label}>
            <LoaderCircle className="notion-spinner" size={16} strokeWidth={1.5} aria-hidden="true" />
            <span className="settings-sr-only">{label}</span>
        </span>
    )
}

export function NotionPageSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="notion-page-skeleton" role="status" aria-label="Loading pages" aria-busy="true">
            {Array.from({ length: rows }, (_, index) => (
                <div className="notion-loading-row" aria-hidden="true" key={index}>
                    <Skeleton shape="block" animation="shimmer" className="notion-loading-icon" />
                    <Skeleton shape="block" animation="shimmer" className="notion-loading-title" />
                </div>
            ))}
        </div>
    )
}
