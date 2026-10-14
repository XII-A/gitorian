import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import type { RepositoryImportProgress, State } from '../shared/model'
import { motionTokens } from './components/arc/lib/motion-tokens'

const ProgressNumber = ({ value }: { value: number | string }) => {
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

export const ImportProgressLabel = ({
    progress,
    activeImport
}: {
    progress?: RepositoryImportProgress
    activeImport?: State['repositoryImport']
}) => {
    const processing = (() => {
        if (progress?.stage === 'processing') {
            return progress
        }
        if (progress) {
            return
        }
        return activeImport
    })()
    return (
        <span aria-live="polite" aria-atomic="true">
            {(() => {
                if (processing) {
                    return (
                        <>
                            Processing repositories <ProgressNumber value={processing.completed} />/
                            <ProgressNumber value={processing.total || '…'} />
                        </>
                    )
                }
                if (progress?.stage === 'discovering') {
                    return (
                        <>
                            Finding repositories… <ProgressNumber value={progress.found} /> found
                        </>
                    )
                }
                if (progress?.stage === 'selecting') {
                    return 'Waiting for folder selection…'
                }

                return 'Add repositories from folder'
            })()}
        </span>
    )
}
