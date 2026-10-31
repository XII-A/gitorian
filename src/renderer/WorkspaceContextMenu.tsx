import type { SpellingContext } from '../shared/model'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ContextMenu } from './components/arc/context-menu/context-menu'

export function WorkspaceContextMenu({ children }: { children: ReactNode }) {
    const [spelling, setSpelling] = useState<SpellingContext>()
    const subscribeOpen = useCallback(
        (open: (x: number, y: number, target: HTMLElement) => void) =>
            window.journal.spelling!.onContext((context) => {
                const target = document.elementFromPoint(context.x, context.y)
                if (!(target instanceof HTMLElement) || !target.closest('[data-workspace-context]')) return
                setSpelling(
                    target.closest('[spellcheck="false"]')
                        ? { ...context, word: '', suggestions: [], editable: false }
                        : context
                )
                open(context.x, context.y, target)
            }),
        []
    )
    const restore = useRef<(() => void) | undefined>(undefined)
    const [available, setAvailable] = useState({ cut: false, copy: false, paste: false })

    function capture(target: HTMLElement, native = false) {
        if (!native) setSpelling(undefined)
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
            subscribeOpen={window.journal.spelling ? subscribeOpen : undefined}
            openOnClick={false}
            onOpen={capture}
            restoreFocus={() => restore.current?.()}
            items={[
                ...(spelling?.word
                    ? [
                          ...spelling.suggestions.map((word) => ({
                              id: `spelling-${word}`,
                              label: word,
                              onSelect: () => {
                                  void window.journal.spelling?.act(spelling.id, 'replace', word)
                              }
                          })),
                          {
                              id: 'learn',
                              label: 'Add to dictionary',
                              separatorBefore: spelling.suggestions.length > 0,
                              onSelect: () => {
                                  void window.journal.spelling?.act(spelling.id, 'learn')
                              }
                          }
                      ]
                    : []),
                ...(spelling?.editable && (spelling.word || !spelling.enabled)
                    ? [
                          {
                              id: 'spellcheck',
                              label: spelling.enabled ? 'Disable spell check' : 'Enable spell check',
                              onSelect: () => {
                                  void window.journal.spelling?.act(spelling.id, 'toggle')
                              }
                          }
                      ]
                    : []),
                {
                    id: 'cut',
                    label: 'Cut',
                    shortcut: 'Ctrl+X',
                    disabled: !available.cut,
                    onSelect: () => {
                        void window.journal.clipboard?.('cut')
                    }
                },
                {
                    id: 'copy',
                    label: 'Copy',
                    shortcut: 'Ctrl+C',
                    disabled: !available.copy,
                    onSelect: () => {
                        void window.journal.clipboard?.('copy')
                    }
                },
                {
                    id: 'paste',
                    label: 'Paste',
                    shortcut: 'Ctrl+V',
                    disabled: !available.paste,
                    onSelect: () => {
                        void window.journal.clipboard?.('paste')
                    }
                }
            ]
                .filter((item) => !('disabled' in item && item.disabled))
                .map((item, index, items) => ({
                    ...item,
                    separatorBefore:
                        ('separatorBefore' in item && item.separatorBefore) ||
                        (index > 0 &&
                            ['cut', 'copy', 'paste'].includes(item.id) &&
                            !['cut', 'copy', 'paste'].includes(items[index - 1].id))
                }))}
        >
            <div data-workspace-context>{children}</div>
        </ContextMenu>
    )
}
