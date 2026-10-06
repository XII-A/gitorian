import type { ReactNode } from 'react'
import { Accordion } from './arc/accordion/accordion'

export function Disclosure({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
    return (
        <div className={className}>
            <Accordion defaultOpen={-1} items={[{ title, content: children }]} />
        </div>
    )
}
