import { useRef, useState } from 'react'
import { Search, ArrowUpRight } from 'lucide-react'
import { Dialog, DialogContent } from './arc/dialog/dialog'
import { Input } from './arc/input/input'
import { Button } from './arc/button/button'

export interface WorkspaceCommand {
    name: string
    hint: string
    action: () => void
}
export function CommandMenu({ commands, close }: { commands: WorkspaceCommand[]; close: () => void }) {
    const [query, setQuery] = useState('')
    const search = useRef<HTMLInputElement>(null)
    const [previousFocus] = useState(() => document.activeElement)
    const matches = commands.filter((command) =>
        `${command.name} ${command.hint}`.toLowerCase().includes(query.toLowerCase())
    )
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) close()
            }}
        >
            <DialogContent
                title="Jump to…"
                className="command-menu"
                aria-describedby={undefined}
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    search.current?.focus()
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (previousFocus instanceof HTMLElement) previousFocus.focus()
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    event.preventDefault()
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.command-item')]
                    const index = buttons.findIndex((button) => button === document.activeElement)
                    const next =
                        index < 0
                            ? event.key === 'ArrowDown'
                                ? 0
                                : buttons.length - 1
                            : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
                    buttons[next]?.focus()
                }}
            >
                <div>
                    <Input
                        ref={search}
                        label="Search commands"
                        placeholder="Where would you like to go?"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && matches[0]) {
                                close()
                                matches[0].action()
                            }
                        }}
                    />
                    <div className="command-results">
                        {matches.map((command) => (
                            <Button
                                key={command.name}
                                variant="ghost"
                                contentLayout="stack"
                                className="command-item"
                                onClick={() => {
                                    close()
                                    command.action()
                                }}
                            >
                                <span className="row between">
                                    <span className="row">
                                        <Search size={15} />
                                        {command.name}
                                    </span>
                                    <ArrowUpRight size={14} />
                                </span>
                                <span className="muted">{command.hint}</span>
                            </Button>
                        ))}
                        {!matches.length && (
                            <p className="list-empty">No commands match. Try “journal” or “settings”.</p>
                        )}
                    </div>
                    <footer className="command-help">
                        <span>↑ ↓ to navigate · Enter to open</span>
                        <span>Esc to close</span>
                    </footer>
                </div>
            </DialogContent>
        </Dialog>
    )
}
