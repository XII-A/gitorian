import { Diff, IndentDecrease, SlidersHorizontal, WrapText } from 'lucide-react'
import { useRef } from 'react'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { ToggleGroup } from './components/arc/toggle-group/toggle-group'

export interface DiffDisplayPreferences {
    split: boolean
    onSplitChange: (split: boolean) => void
    wrapLines: boolean
    onWrapLinesChange: (wrap: boolean) => void
    originalIndentation: boolean
    onOriginalIndentationChange: (original: boolean) => void
    showLineCounts: boolean
    onShowLineCountsChange: (show: boolean) => void
}

export function DiffDisplayOptions(props: DiffDisplayPreferences) {
    const content = useRef<HTMLDivElement>(null)
    const readingTools = [
        ...(props.wrapLines ? ['wrap'] : []),
        ...(!props.originalIndentation ? ['compact'] : []),
        ...(props.showLineCounts ? ['counts'] : [])
    ]
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    className="diff-toolbar-icon"
                    variant="ghost"
                    size="sm"
                    aria-label="Diff display options"
                    title="Display options"
                >
                    <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                ref={content}
                className="diff-options-popover"
                align="end"
                aria-label="Diff display options"
                onOpenAutoFocus={(event) => {
                    const selected = content.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
                    if (!selected) return
                    event.preventDefault()
                    selected.focus()
                }}
            >
                <ScrollArea
                    label="Display settings"
                    viewportClassName="diff-options-viewport"
                    maxHeight="var(--radix-popover-content-available-height)"
                    fade={8}
                >
                    <div className="diff-options-body">
                        <SegmentedControl
                            label="Diff layout"
                            size="sm"
                            fullWidth
                            value={props.split ? 'split' : 'unified'}
                            onValueChange={(value) => props.onSplitChange(value === 'split')}
                            options={[
                                { value: 'split', label: 'Split' },
                                { value: 'unified', label: 'Unified' }
                            ]}
                        />
                        <ToggleGroup
                            className="diff-options-group"
                            type="multiple"
                            label="Reading tools"
                            size="sm"
                            value={readingTools}
                            onValueChange={(values) => {
                                props.onWrapLinesChange(values.includes('wrap'))
                                props.onOriginalIndentationChange(!values.includes('compact'))
                                props.onShowLineCountsChange(values.includes('counts'))
                            }}
                        >
                            <ToggleGroup.Item value="wrap" label="Wrap lines" tooltip="Wrap lines">
                                <WrapText aria-hidden="true" />
                            </ToggleGroup.Item>
                            <ToggleGroup.Item value="compact" label="Compact indentation" tooltip="Compact indentation">
                                <IndentDecrease aria-hidden="true" />
                            </ToggleGroup.Item>
                            <ToggleGroup.Item value="counts" label="Show line counts" tooltip="Show line counts">
                                <Diff aria-hidden="true" />
                            </ToggleGroup.Item>
                        </ToggleGroup>
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
