import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { RepositoryImportProgress, State } from '../shared/model'
import { motionTokens } from './components/arc/motion-tokens'

function ProgressNumber({ value }: { value: number | string }) {
    const reduce = useReducedMotion()
    return (
        <span className="settings-progress-number">
            <span className="settings-sr-only">{value}</span>
            <AnimatePresence initial={false}>
                <motion.span
                    key={value}
                    aria-hidden="true"
                    initial={reduce ? false : { opacity: 0, y: '0.4em' }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: '-0.4em' }}
                    transition={{ duration: reduce ? 0 : motionTokens.duration.fast, ease: motionTokens.ease.standard }}
                >
                    {value}
                </motion.span>
            </AnimatePresence>
        </span>
    )
}

export function ImportProgressLabel({
    progress,
    activeImport
}: {
    progress?: RepositoryImportProgress
    activeImport?: State['repositoryImport']
}) {
    const processing = progress?.stage === 'processing' ? progress : !progress ? activeImport : undefined
    return (
        <span aria-live="polite" aria-atomic="true">
            {processing ? (
                <>
                    Processing repositories <ProgressNumber value={processing.completed} />/
                    <ProgressNumber value={processing.total || '…'} />
                </>
            ) : progress?.stage === 'discovering' ? (
                <>
                    Finding repositories… <ProgressNumber value={progress.found} /> found
                </>
            ) : progress?.stage === 'selecting' ? (
                'Waiting for folder selection…'
            ) : (
                'Add repositories from folder'
            )}
        </span>
    )
}
