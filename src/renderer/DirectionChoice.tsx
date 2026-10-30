import { useState, useRef } from 'react'
import { MoveHorizontal } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { RadioGroup } from './components/arc/radio-group/radio-group'
import { directionLabels, writingDirection, writingDirections } from '../shared/journal-direction'
import type { WritingDirection } from '../shared/journal-direction'

export function DirectionChoice({
    label,
    value,
    change,
    restoreFocus,
    inherit = false,
    iconOnly = false
}: {
    label: string
    value: WritingDirection | null | 'mixed'
    change: (direction: WritingDirection | null) => void
    restoreFocus: () => void
    inherit?: boolean
    iconOnly?: boolean
}) {
    const [open, setOpen] = useState(false)
    const returnFocus = useRef(true)
    const current = value === 'mixed' ? 'Mixed' : value === null ? 'Document default' : directionLabels[value]
    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) {
                    returnFocus.current = true
                }
                setOpen(next)
            }}
        >
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={`${label}: ${current}`}>
                    <MoveHorizontal size={16} aria-hidden="true" />
                    {!iconOnly && label}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                aria-label={label}
                className="journal-direction-menu"
                onInteractOutside={() => {
                    returnFocus.current = false
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (returnFocus.current) restoreFocus()
                }}
            >
                <RadioGroup
                    label={label}
                    value={value ?? 'inherit'}
                    options={[
                        ...(inherit ? [{ value: 'inherit', label: 'Use document default' }] : []),
                        ...writingDirections.map((direction) => ({
                            value: direction,
                            label: directionLabels[direction]
                        }))
                    ]}
                    onValueChange={(next) => {
                        change(writingDirection(next) ?? null)
                        setOpen(false)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}
