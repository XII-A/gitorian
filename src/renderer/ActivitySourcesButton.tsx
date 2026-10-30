import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import type { State } from '../shared/model'
import { sourceProblems } from './background-work'
import { Button } from './components/arc/button/button'
import { Tooltip } from './components/arc/tooltip/tooltip'
import styles from './ActivitySourcesButton.module.css'

export function ActivitySourcesButton({ state, onClick }: { state: State; onClick: () => void }) {
    if (!sourceProblems(state).length) return null
    return (
        <Tooltip content="Activity sources need attention" side="bottom">
            <Button
                variant="ghost"
                size="sm"
                data-source-status
                onClick={onClick}
                aria-label="Activity sources"
                className={styles.trigger}
                animateContent={false}
            >
                <span className={styles.icon} aria-hidden="true">
                    <StackIcon size={18} weight="bold" />
                    <span className={styles.dot} />
                </span>
            </Button>
        </Tooltip>
    )
}
