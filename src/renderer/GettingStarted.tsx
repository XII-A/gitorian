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
                    title: 'Connect an account',
                    description: 'Connect GitHub or GitLab to include pull requests and reviews.',
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
