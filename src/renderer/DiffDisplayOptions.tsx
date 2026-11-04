import { SlidersHorizontal } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { Switch } from './components/arc/switch/switch'

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
            <PopoverContent className="diff-display-options" align="end" aria-label="Diff display options">
                <div className="diff-display-layout">
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
                </div>
                <div className="diff-display-toggles">
                    <Switch
                        label="Wrap lines"
                        size="sm"
                        labelPosition="start"
                        checked={props.wrapLines}
                        onCheckedChange={props.onWrapLinesChange}
                    />
                    <Switch
                        label="Compact indentation"
                        size="sm"
                        labelPosition="start"
                        checked={!props.originalIndentation}
                        onCheckedChange={(compact) => props.onOriginalIndentationChange(!compact)}
                    />
                    <Switch
                        label="Line counts"
                        size="sm"
                        labelPosition="start"
                        checked={props.showLineCounts}
                        onCheckedChange={props.onShowLineCountsChange}
                    />
                </div>
            </PopoverContent>
        </Popover>
    )
}
