import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useRowHover } from './use-row-hover'

export function HistoryHover({ children }: { children: ReactNode }) {
    const { root, style, handlers } = useRowHover('.history-row', children)
    return (
        <div className="history-hover" ref={root} {...handlers}>
            <motion.span className="history-hover-highlight" style={style} aria-hidden="true" />
            {children}
        </div>
    )
}
