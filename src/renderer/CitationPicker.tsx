import { useMemo, useState } from 'react'
import { createCommandController } from '@ui-sdk/core/command'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@ui-sdk/react/command'
import type { Activity, Repository } from '../shared/model'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { CornerDownLeft } from 'lucide-react'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Input } from './components/arc/input/input'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import styles from './CitationPicker.module.css'

export function CitationPicker({
    activities,
    repositories,
    open,
    onOpenChange,
    onChoose,
    onReturn
}: {
    activities: Activity[]
    repositories: Repository[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onChoose: (activity: Activity) => void
    onReturn: () => void
}) {
    const [controller] = useState(createCommandController)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                title="Cite an activity"
                backdrop="dim"
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    controller.focus()
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    onReturn()
                }}
                onEscapeKeyDown={(event) => event.stopPropagation()}
            >
                <Results
                    activities={activities}
                    repositories={repositories}
                    controller={controller}
                    onChoose={(activity) => {
                        onOpenChange(false)
                        onChoose(activity)
                    }}
                />
            </DialogContent>
        </Dialog>
    )
}

function Results({
    activities,
    repositories,
    controller,
    onChoose
}: {
    activities: Activity[]
    repositories: Repository[]
    controller: ReturnType<typeof createCommandController>
    onChoose: (activity: Activity) => void
}) {
    const { items, byId } = useMemo(() => {
        const names = new Map(repositories.map((repo) => [repo.id, repo.name]))
        const byId = new Map(activities.map((activity) => [activity.id, activity]))
        const items = activities.map((activity) => ({
            value: activity.id,
            label: activity.title.trim() || 'Untitled activity',
            keywords: [names.get(activity.repositoryId) ?? '', activity.sha ?? '', ...activity.branches],
            repository: names.get(activity.repositoryId) ?? 'Repository'
        }))
        return { items, byId }
    }, [activities, repositories])
    return (
        <Command
            controller={controller}
            items={items}
            className={styles.command}
            onAction={(id) => {
                const activity = byId.get(id)
                if (activity) onChoose(activity)
            }}
        >
            <CommandInput render={<Input label="Search activities" hideLabel placeholder="Search activities…" />} />
            <ScrollArea className={styles.results} fade={8}>
                <CommandEmpty className={styles.empty}>No matching activities</CommandEmpty>
                <CommandList aria-label="Activities">
                    {({ items: matches }) =>
                        (matches as typeof items).map((item) => {
                            const activity = byId.get(item.value)!
                            return (
                                <CommandItem
                                    key={item.value}
                                    className={styles.item}
                                    value={item.value}
                                    label={item.label}
                                >
                                    <WorkspaceIcon name={activity.kind === 'commit' ? 'commit' : 'change-request'} />
                                    <span className={styles.text}>
                                        <span className={styles.title} title={item.label}>
                                            {item.label}
                                        </span>
                                        <span className={styles.meta}>
                                            {item.repository}
                                            {activity.sha && <code> · {activity.sha.slice(0, 7)}</code>}
                                        </span>
                                    </span>
                                    <CornerDownLeft className={styles.enter} size={14} aria-hidden="true" />
                                </CommandItem>
                            )
                        })
                    }
                </CommandList>
            </ScrollArea>
        </Command>
    )
}
