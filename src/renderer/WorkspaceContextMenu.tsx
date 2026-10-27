import { useRef, useState, type ReactNode } from 'react'
import { ClipboardPaste, Copy, Scissors } from 'lucide-react'
import { ContextMenu } from './components/arc/context-menu/context-menu'

export function WorkspaceContextMenu({ children }: { children: ReactNode }) {
    const restore = useRef<(() => void) | undefined>(undefined)
    const [available, setAvailable] = useState({ cut: false, copy: false, paste: false })

    function capture(target: HTMLElement) {
        const field = target.closest('input, textarea')
        const editable = target.closest<HTMLElement>('[contenteditable]')
        const selection = window.getSelection()
        const ranges = selection
            ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
            : []
        const input = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : undefined
        const start = input?.selectionStart ?? 0
        const end = input?.selectionEnd ?? 0
        const direction = input?.selectionDirection ?? 'none'
        const writable = input ? !input.readOnly && !input.disabled : !!editable?.isContentEditable
        const selected = input ? end > start : !!selection && !selection.isCollapsed
        setAvailable({ cut: writable && selected, copy: selected, paste: writable })
        restore.current = () => {
            if (!target.isConnected) return
            const focusTarget = input ?? editable ?? target
            focusTarget.focus({ preventScroll: true })
            if (input) input.setSelectionRange(start, end, direction)
            else if (selection) {
                selection.removeAllRanges()
                for (const range of ranges) selection.addRange(range)
            }
        }
    }

    return (
        <ContextMenu
            label="Clipboard actions"
            openOnClick={false}
            onOpen={capture}
            restoreFocus={() => restore.current?.()}
            items={[
                {
                    id: 'cut',
                    label: 'Cut',
                    icon: <Scissors size={15} />,
                    shortcut: 'Ctrl+X',
                    disabled: !available.cut,
                    onSelect: () => {
                        void window.journal.clipboard?.('cut')
                    }
                },
                {
                    id: 'copy',
                    label: 'Copy',
                    icon: <Copy size={15} />,
                    shortcut: 'Ctrl+C',
                    disabled: !available.copy,
                    onSelect: () => {
                        void window.journal.clipboard?.('copy')
                    }
                },
                {
                    id: 'paste',
                    label: 'Paste',
                    icon: <ClipboardPaste size={15} />,
                    shortcut: 'Ctrl+V',
                    disabled: !available.paste,
                    onSelect: () => {
                        void window.journal.clipboard?.('paste')
                    }
                }
            ]}
        >
            {children}
        </ContextMenu>
    )
}
