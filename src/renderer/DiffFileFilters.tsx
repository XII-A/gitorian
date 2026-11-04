import { ListFilter } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { Select } from './components/arc/select/select'
import { Switch } from './components/arc/switch/switch'
import {
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

export const diffFileFilters: { value: DiffFileFilter; label: string }[] = [
    { value: 'all', label: 'All files' },
    { value: 'modified', label: 'Modified' },
    { value: 'added', label: 'Added' },
    { value: 'deleted', label: 'Deleted' },
    { value: 'renamed', label: 'Renamed' },
    { value: 'binary', label: 'Binary' }
]

export function DiffFileFilters(props: DiffFileFilterControls) {
    const { files, filter, exclusions, fileList, order } = props
    const changed = filter !== 'all' || exclusions.tests || exclusions.docs || fileList !== 'tree' || order !== 'path'
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
                    <ListFilter size={15} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="diff-file-filters" align="start" aria-label="File filters and ordering">
                <div className="diff-file-filters-heading">
                    <h3>File filters</h3>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!changed}
                        onClick={() => {
                            props.onClearFilters()
                            props.onFileListChange('tree')
                            props.onOrderChange('path')
                        }}
                    >
                        Reset
                    </Button>
                </div>
                <div className="diff-file-filters-section">
                    <div className="diff-file-filter-setting">
                        <span>Change type</span>
                        <Select
                            label=""
                            aria-label="File status"
                            variant="ghost"
                            className="diff-file-filter-select"
                            contentMinWidth={180}
                            value={filter}
                            onValueChange={(value) => {
                                const option = diffFileFilters.find((item) => item.value === value)
                                if (option) props.onFilterChange(option.value)
                            }}
                            options={diffFileFilters.map((item) => ({
                                ...item,
                                count: files.filter((file) => matchesDiffFilter(file, item.value, exclusions)).length
                            }))}
                        />
                    </div>
                </div>
                <div className="diff-file-filters-section">
                    <h4>Exclude</h4>
                    <Switch
                        size="sm"
                        labelPosition="start"
                        label="Test files"
                        aria-label="Exclude test files"
                        checked={exclusions.tests}
                        onCheckedChange={(tests) => props.onExclusionsChange({ ...exclusions, tests })}
                    />
                    <Switch
                        size="sm"
                        labelPosition="start"
                        label="Documentation"
                        aria-label="Exclude documentation"
                        checked={exclusions.docs}
                        onCheckedChange={(docs) => props.onExclusionsChange({ ...exclusions, docs })}
                    />
                </div>
                <div className="diff-file-filters-section">
                    <div className="diff-file-filter-setting">
                        <span>File list</span>
                        <Select
                            label=""
                            aria-label="File list"
                            variant="ghost"
                            className="diff-file-filter-select"
                            value={fileList}
                            onValueChange={(value) => props.onFileListChange(value === 'list' ? 'list' : 'tree')}
                            options={[
                                { value: 'tree', label: 'Tree' },
                                { value: 'list', label: 'List' }
                            ]}
                        />
                    </div>
                    <div className="diff-file-filter-setting">
                        <span>Order by</span>
                        <Select
                            label=""
                            aria-label="File order"
                            variant="ghost"
                            className="diff-file-filter-select"
                            value={order}
                            onValueChange={(value) => props.onOrderChange(value === 'changes' ? 'changes' : 'path')}
                            options={[
                                { value: 'path', label: 'Path' },
                                { value: 'changes', label: 'Changes' }
                            ]}
                        />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}
