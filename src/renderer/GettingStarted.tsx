import { OnboardingChecklist } from './components/arc/onboarding-checklist/onboarding-checklist'
import type { MouseEvent } from 'react'

export type SetupSection = 'connections' | 'repositories'

export function GettingStarted({
    completed,
    onSettings,
    onDismiss
}: {
    completed: string[]
    onSettings: (section: SetupSection) => void
    onDismiss?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
    return (
        <OnboardingChecklist
            title="Set up your journal"
            doneTitle="You’re ready to journal"
            completed={completed}
            onDismiss={onDismiss}
            stepLayout="horizontal"
            steps={[
                {
                    id: 'accounts',
                    title: 'Connect accounts',
                    description: 'Connect GitHub for pull requests and Notion to publish your entries.',
                    actionLabel: 'Connect',
                    onAction: () => onSettings('connections')
                },
                {
                    id: 'repositories',
                    title: 'Import repositories',
                    description: 'Choose local repositories to bring your commits into your journal.',
                    actionLabel: 'Import',
                    onAction: () => onSettings('repositories')
                }
            ]}
        />
    )
}
