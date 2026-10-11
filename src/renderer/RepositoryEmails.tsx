import { useState } from 'react'
import { Plus } from 'lucide-react'
import { MultiSelect } from './components/arc/multi-select/multi-select'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'

export function RepositoryEmails({
    value,
    suggestions,
    onChange
}: {
    value: string[]
    suggestions: string[]
    onChange: (value: string[]) => void
}) {
    const [added, setAdded] = useState<string[]>([])
    const [email, setEmail] = useState('')
    const [open, setOpen] = useState(false)
    const options = [...new Set([...suggestions, ...added, ...value])].filter(Boolean)
    const count = value.filter(Boolean).length
    return (
        <div className="settings-emails">
            <MultiSelect
                label="Author emails"
                value={value.filter(Boolean)}
                options={options.map((value) => ({ value, label: value }))}
                onValueChange={onChange}
                maxVisible={3}
                wrapValues
                placeholder="Choose author emails"
            />
            <div className="settings-email-actions">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm">
                            <Plus size={14} aria-hidden="true" /> Add email
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                        <form
                            className="settings-fields"
                            onSubmit={(event) => {
                                event.preventDefault()
                                const next = email.trim()
                                if (!next) return
                                setAdded((current) => [...new Set([...current, next])])
                                onChange([...new Set([...value.filter(Boolean), next])])
                                setEmail('')
                                setOpen(false)
                            }}
                        >
                            <Input
                                label="Email address"
                                type="email"
                                required
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="you@example.com"
                            />
                            <Button type="submit" size="sm" disabled={!email.trim()}>
                                Add email
                            </Button>
                        </form>
                    </PopoverContent>
                </Popover>
                <span className="settings-hint">
                    {count} {count === 1 ? 'address' : 'addresses'}
                </span>
            </div>
        </div>
    )
}
