import {
    ArrowDownAZ,
    ArrowDownWideNarrow,
    Binary,
    Check,
    ChevronDown,
    Files,
    FolderTree,
    List,
    ListFilter,
    RotateCcw
} from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Button } from './components/arc/button/button'
import { DropdownMenu } from './components/arc/dropdown-menu/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Select } from './components/arc/select/select'
import { ToggleGroup } from './components/arc/toggle-group/toggle-group'
import { Tooltip } from './components/arc/tooltip/tooltip'
import {
    FileChangeIcon,
    matchesDiffFilter,
    type DiffFileExclusions,
    type DiffFileFilter,
    type DiffFileList,
    type DiffFileOrder
} from './diff-file-presentation'
import type { DiffFile } from './diff-model'

export interface DiffFileFilterControls {
    files: DiffFile[]
    filter: DiffFileFilter
    onFilterChange: (filter: DiffFileFilter) => void
    exclusions: DiffFileExclusions
    onExclusionsChange: (exclusions: DiffFileExclusions) => void
    onClearFilters: () => void
    fileList: DiffFileList
    onFileListChange: (list: DiffFileList) => void
    order: DiffFileOrder
    onOrderChange: (order: DiffFileOrder) => void
}

export const diffFileFilters: { value: DiffFileFilter; label: string; icon: ReactNode }[] = [
    { value: 'all', label: 'All files', icon: <Files size={16} strokeWidth={1.75} /> },
    { value: 'modified', label: 'Modified', icon: <FileChangeIcon kind="modified" /> },
    { value: 'added', label: 'Added', icon: <FileChangeIcon kind="added" /> },
    { value: 'deleted', label: 'Deleted', icon: <FileChangeIcon kind="deleted" /> },
    { value: 'renamed', label: 'Renamed', icon: <FileChangeIcon kind="renamed" /> },
    { value: 'binary', label: 'Binary', icon: <Binary size={16} strokeWidth={1.75} /> }
]

export function DiffFileFilters(props: DiffFileFilterControls) {
    const changeType = useRef<HTMLButtonElement>(null)
    const { files, filter, exclusions, fileList, order } = props
    const changed = filter !== 'all' || fileList !== 'tree' || order !== 'path'
    const canReset = changed || exclusions.tests || exclusions.docs
    const OrderIcon = order === 'path' ? ArrowDownAZ : ArrowDownWideNarrow
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    className="diff-toolbar-icon"
                    variant="ghost"
                    size="sm"
                    aria-label="File filters and ordering"
                    title="Filter files"
                    data-active={changed}
                >
                    <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="diff-options-popover"
                align="end"
                aria-label="File filters and ordering"
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    changeType.current?.focus()
                }}
            >
                <ScrollArea
                    label="File settings"
                    viewportClassName="diff-options-viewport"
                    maxHeight="var(--radix-popover-content-available-height)"
                    fade={8}
                >
                    <div className="diff-options-body">
                        <div className="diff-options-summary">
                            <Select
                                ref={changeType}
                                className="diff-options-select"
                                label=""
                                aria-label="Change type"
                                variant="ghost"
                                contentMinWidth={224}
                                value={filter}
                                onValueChange={(value) => {
                                    const option = diffFileFilters.find((item) => item.value === value)
                                    if (option) props.onFilterChange(option.value)
                                }}
                                options={diffFileFilters.map((item) => ({
                                    ...item,
                                    count: files.filter((file) => matchesDiffFilter(file, item.value, exclusions))
                                        .length
                                }))}
                            />
                            <Tooltip content="Reset file options">
                                <Button
                                    className="diff-options-reset"
                                    variant="ghost"
                                    size="xs"
                                    aria-label="Reset file options"
                                    disabled={!canReset}
                                    onClick={() => {
                                        props.onClearFilters()
                                        props.onFileListChange('tree')
                                        props.onOrderChange('path')
                                    }}
                                >
                                    <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                        </div>
                        <div className="diff-options-footer">
                            <ToggleGroup
                                label="File list"
                                size="sm"
                                value={fileList}
                                onValueChange={(value) => props.onFileListChange(value === 'list' ? 'list' : 'tree')}
                            >
                                <ToggleGroup.Item value="tree" label="Tree view" tooltip="Tree view">
                                    <FolderTree aria-hidden="true" />
                                </ToggleGroup.Item>
                                <ToggleGroup.Item value="list" label="List view" tooltip="List view">
                                    <List aria-hidden="true" />
                                </ToggleGroup.Item>
                            </ToggleGroup>
                            <DropdownMenu
                                label="Sort files"
                                trigger={
                                    <Button
                                        className="diff-options-sort"
                                        variant="ghost"
                                        size="xs"
                                        aria-label="Sort files"
                                    >
                                        <OrderIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                                        {order === 'path' ? 'Path' : 'Changes'}
                                        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
                                    </Button>
                                }
                                items={[
                                    {
                                        label: 'Sort by path',
                                        icon:
                                            order === 'path' ? (
                                                <Check size={16} aria-hidden="true" />
                                            ) : (
                                                <ArrowDownAZ size={16} aria-hidden="true" />
                                            ),
                                        onSelect: () => props.onOrderChange('path')
                                    },
                                    {
                                        label: 'Sort by changes',
                                        icon:
                                            order === 'changes' ? (
                                                <Check size={16} aria-hidden="true" />
                                            ) : (
                                                <ArrowDownWideNarrow size={16} aria-hidden="true" />
                                            ),
                                        onSelect: () => props.onOrderChange('changes')
                                    }
                                ]}
                            />
                        </div>
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
