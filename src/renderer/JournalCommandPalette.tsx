import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Activity, Repository } from '../shared/model'
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { changeRequestNumber } from './pull-request'
import styles from './JournalCommandPalette.module.css'

interface PaletteAction {
    label: string
    icon?: ReactNode
    run: () => void | Promise<void>
    restoreFocus?: boolean
}

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    restoreEditorFocus?: () => void
    actions: PaletteAction[]
    activities: Activity[]
    repositories: Repository[]
    primaryLabel: string
    onActivity: (activity: Activity) => void
    secondaryLabel: string
    secondaryRestoreFocus?: boolean
    secondaryAction: (activity: Activity) => (() => void) | undefined
}

export function JournalCommandPalette({ open, onOpenChange, restoreEditorFocus, ...props }: Props) {
    const [present, setPresent] = useState(false)
    const previousFocus = useRef<HTMLElement | null>(null)
    const command = useRef<PaletteAction | undefined>(undefined)
    useLayoutEffect(() => {
        if (open) {
            setPresent(true)
            return
        }
        if (!present) return
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setPresent(false)
            return
        }
        const timer = setTimeout(() => setPresent(false), 130)
        return () => clearTimeout(timer)
    }, [open, present])

    if (!open && !present) return null
    function select(action: PaletteAction) {
        if (!open || command.current) return
        command.current = action
        onOpenChange(false)
    }
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal forceMount>
                <Dialog.Overlay forceMount className={styles.overlay} />
                <Dialog.Content
                    forceMount
                    data-command-palette=""
                    data-command-pending={command.current ? true : undefined}
                    className={styles.dialog}
                    aria-describedby={undefined}
                    onEscapeKeyDown={(event) => event.stopPropagation()}
                    onOpenAutoFocus={() => {
                        previousFocus.current =
                            document.activeElement instanceof HTMLElement ? document.activeElement : null
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        const action = command.current
                        command.current = undefined
                        if (!action || action.restoreFocus) {
                            if (restoreEditorFocus && previousFocus.current?.closest('.tiptap')) restoreEditorFocus()
                            else previousFocus.current?.focus({ preventScroll: true })
                        }
                        void action?.run()
                    }}
                >
                    <Dialog.Title className={styles.srOnly}>Command palette</Dialog.Title>
                    <JournalCommands {...props} select={select} close={() => onOpenChange(false)} />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

function JournalCommands({
    actions,
    activities,
    repositories,
    primaryLabel,
    onActivity,
    secondaryLabel,
    secondaryRestoreFocus,
    secondaryAction,
    select,
    close
}: Omit<Props, 'open' | 'onOpenChange'> & {
    select: (action: PaletteAction) => void
    close: () => void
}) {
    const { commands, byId } = useMemo(() => {
        const names = new Map(repositories.map((repo) => [repo.id, repo.name]))
        const list: (CommandItem & { primary: PaletteAction; secondary?: PaletteAction })[] = actions.map((action) => ({
            id: 'action:' + action.label,
            label: action.label,
            icon: action.icon,
            group: 'Actions',
            primary: action
        }))
        for (const activity of activities) {
            const label = activity.title.trim() || 'Untitled activity'
            const number = changeRequestNumber(activity)
            const group = names.get(activity.repositoryId) ?? 'Repository'
            const secondary = secondaryAction(activity)
            list.push({
                id: 'activity:' + activity.id,
                group,
                label,
                primaryLabel,
                secondaryLabel: secondary && secondaryLabel,
                primary: { label: primaryLabel, run: () => onActivity(activity) },
                secondary: secondary && {
                    label: secondaryLabel,
                    run: secondary,
                    restoreFocus: secondaryRestoreFocus
                },
                description:
                    activity.kind === 'commit'
                        ? activity.sha?.slice(0, 7)
                        : number
                          ? `#${number}`
                          : activity.branches[0],
                keywords: [
                    group,
                    activity.kind,
                    activity.kind === 'commit' ? '' : 'pr pull request merge request',
                    number ? `#${number}` : '',
                    activity.sha ?? '',
                    ...activity.branches
                ],
                icon: <WorkspaceIcon name={activity.kind === 'commit' ? 'commit' : 'change-request'} />
            })
        }
        return { commands: list, byId: new Map(list.map((item) => [item.id, item])) }
    }, [
        actions,
        activities,
        repositories,
        primaryLabel,
        onActivity,
        secondaryLabel,
        secondaryRestoreFocus,
        secondaryAction
    ])
    return (
        <CommandPalette
            items={commands}
            label="Command palette"
            placeholder="Search actions and activities…"
            modifierLabel={/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}
            onClose={close}
            onSelect={(item) => select(byId.get(item.id)!.primary)}
            onModEnter={(item) => {
                const action = byId.get(item.id)?.secondary
                if (action) select(action)
            }}
        />
    )
}
