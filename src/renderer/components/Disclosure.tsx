import type { ReactNode } from 'react'

import { Accordion } from './arc/accordion/accordion'

export const Disclosure = ({
    title,
    children,
    className
}: {
    title: string
    children: ReactNode
    className?: string
}) => (
    <div className={className}>
        <Accordion defaultOpen={-1} items={[{ content: children, title }]} />
    </div>
)
