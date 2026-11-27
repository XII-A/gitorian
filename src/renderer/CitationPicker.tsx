import { useMemo } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Activity, Repository } from '../shared/model'
import { CommandPalette } from './components/arc/command-palette/command-palette'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import styles from './CitationPicker.module.css'

interface ActivityCommandsProps {
    activities: Activity[]
    repositories: Repository[]
    shortcut: string
    onChoose: (activity: Activity) => void
}

export function CitationPicker({
    activities,
    repositories,
    open,
    shortcut,
    onOpenChange,
    onChoose,
    onReturn
}: ActivityCommandsProps & {
    open: boolean
    onOpenChange: (open: boolean) => void
    onReturn: () => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.overlay} />
                <Dialog.Content
                    className={styles.dialog}
                    aria-describedby={undefined}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        onReturn()
                    }}
                >
                    <Dialog.Title className={styles.srOnly}>Cite an activity</Dialog.Title>
                    <ActivityCommands
                        activities={activities}
                        repositories={repositories}
                        shortcut={shortcut}
                        onClose={() => onOpenChange(false)}
                        onChoose={onChoose}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

function ActivityCommands({
    activities,
    repositories,
    shortcut,
    onClose,
    onChoose
}: ActivityCommandsProps & { onClose: () => void }) {
    const items = useMemo(() => {
        const names = new Map(repositories.map((repo) => [repo.id, repo.name]))
        return activities.map((activity) => ({
            id: activity.id,
            label: activity.title.trim() || 'Untitled activity',
            group: names.get(activity.repositoryId) ?? 'Repository',
            description: activity.sha?.slice(0, 7) ?? activity.branches[0],
            keywords: [names.get(activity.repositoryId) ?? '', activity.sha ?? '', ...activity.branches],
            icon: <WorkspaceIcon name={activity.kind === 'commit' ? 'commit' : 'change-request'} />
        }))
    }, [activities, repositories])
    return (
        <CommandPalette
            items={items}
            emptyLabel="No activities this week"
            label="Search activities"
            placeholder="Search activities to cite…"
            shortcutHint={shortcut}
            onClose={onClose}
            onSelect={(item) => {
                const activity = activities.find((activity) => activity.id === item.id)
                if (activity) {
                    onClose()
                    onChoose(activity)
                }
            }}
        />
    )
}
