import { Skeleton } from './components/arc/skeleton/skeleton'

/** Reserve the toolbar and code area for both fetching and parsing a patch. */
export function DiffSkeleton({ label = 'Loading changes' }: { label?: string }) {
    return (
        <div className="ws-diff-skeleton" aria-busy="true">
            <div className="ws-diff-tools">
                <Skeleton lines={1} label={label} />
                <div aria-hidden="true">
                    <Skeleton lines={1} />
                </div>
            </div>
            <div className="ws-diff-skeleton-code" aria-hidden="true">
                <Skeleton lines={6} />
                <Skeleton lines={6} />
            </div>
        </div>
    )
}
