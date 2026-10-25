import type { NotionDiscoveryProgress } from '../shared/model'
import { AnimatedCounter } from './components/arc/animated-counter/animated-counter'

export function notionDiscoveryLabel(progress: NotionDiscoveryProgress) {
    if (progress.stage === 'discovering' && !progress.found) return 'Finding pages'
    if (progress.stage === 'waiting') return 'Waiting for Notion'

    return progress.stage === 'discovering'
        ? `Found ${progress.found.toLocaleString()} ${progress.found === 1 ? 'page' : 'pages'}`
        : `Grouped ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} ${progress.total === 1 ? 'page' : 'pages'}`
}

export function NotionDiscoveryStatus({ progress }: { progress: NotionDiscoveryProgress }) {
    if (progress.stage === 'waiting' || (progress.stage === 'discovering' && !progress.found))
        return <span className="notion-discovery-status">{notionDiscoveryLabel(progress)}</span>
    return (
        <span className="notion-discovery-status" aria-hidden="true" aria-label={notionDiscoveryLabel(progress)}>
            {progress.stage === 'discovering' ? 'Found' : 'Grouped'}{' '}
            <AnimatedCounter
                variant="inline"
                value={progress.stage === 'discovering' ? progress.found : progress.completed}
            />
            {progress.stage === 'grouping' && (
                <>
                    {' '}
                    of <AnimatedCounter variant="inline" value={progress.total} />
                </>
            )}{' '}
            {(progress.stage === 'discovering' ? progress.found : progress.total) === 1 ? 'page' : 'pages'}
        </span>
    )
}
