import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/lib/motion-tokens'

/** Prepare the account in layout while hidden; reveal only after the action has landed. */
export function ConnectionIdentity({ ready, children }: { ready: boolean; children: ReactNode }) {
    const reduced = useReducedMotion()
    return (
        <motion.div
            className="connection-identity"
            aria-hidden={!ready}
            data-revealed={ready}
            initial={false}
            animate={{ opacity: ready ? 1 : 0, transform: ready || reduced ? 'translateY(0px)' : 'translateY(4px)' }}
            transition={{
                duration: reduced ? motionTokens.duration.fast : motionTokens.duration.standard,
                ease: [...motionTokens.ease.enter]
            }}
        >
            {children}
        </motion.div>
    )
}
