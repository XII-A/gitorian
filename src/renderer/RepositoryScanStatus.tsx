import { motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'

const marks = {
    loading: ['M12 3 C17 3 21 7 21 12 C21 17 17 21 12 21', 'M12 21 C7 21 3 17 3 12 C3 9 4 6 6 5'],
    success: ['M5 12 C6 13 8 15 9 16 C9.4 16.4 9.7 16.7 10 17', 'M10 17 C12 15 15 12 17 10 C18 9 18.5 8.5 19 8'],
    error: ['M6 6 C8 8 10 10 12 12 C14 14 16 16 18 18', 'M6 18 C8 16 10 14 12 12 C14 10 16 8 18 6']
} as const

export function RepositoryScanStatus({
    status,
    description,
    detail
}: {
    status: keyof typeof marks
    description: string
    detail?: string
}) {
    const reduced = useReducedMotion()
    return (
        <div className="repository-scan-status" data-status={status} role="status" aria-atomic="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {marks[status].map((path, index) => (
                    <motion.path
                        key={index}
                        initial={false}
                        animate={{ d: path }}
                        transition={{
                            duration: reduced ? 0 : motionTokens.duration.standard,
                            ease: [...motionTokens.ease.inOut]
                        }}
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                ))}
            </svg>
            <div className="repository-scan-description">
                <p>{description}</p>
                {detail && <p className="settings-hint">{detail}</p>}
            </div>
        </div>
    )
}
