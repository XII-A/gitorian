export function shortcutLabels(platform: string) {
    const primaryModifier = /Mac/i.test(platform) ? '⌘' : 'Ctrl'
    return {
        primaryModifier,
        settings: `${primaryModifier}+,`,
        previous: 'Alt+←',
        next: 'Alt+→',
        refresh: 'F5',
        focus: primaryModifier + '+\\'
    }
}

export const shortcuts = shortcutLabels(navigator.platform)

export function journalShortcut(event: KeyboardEvent) {
    if (event.shiftKey || event.isComposing || event.defaultPrevented) return
    const mac = shortcuts.primaryModifier === '⌘'
    const primary = mac ? event.metaKey : event.ctrlKey
    if (mac ? event.ctrlKey : event.metaKey) return
    if (primary && !event.altKey) {
        if (event.key === ',') return shortcuts.settings
        if (event.key === '\\') return shortcuts.focus
    }
    if (!primary && !event.altKey && event.key === 'F5') return shortcuts.refresh
    if (!primary && event.altKey) {
        if (
            event.target instanceof HTMLElement &&
            (event.target.isContentEditable || event.target.closest('input, textarea, [role="textbox"]'))
        )
            return
        if (event.key === 'ArrowLeft') return shortcuts.previous
        if (event.key === 'ArrowRight') return shortcuts.next
    }
}

export function journalModalOpen() {
    return !!document.querySelector(
        '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"], dialog:modal, [data-command-pending]'
    )
}

export function journalOverlayOpen(shortcut: string) {
    return (
        journalModalOpen() ||
        !!document.querySelector(
            '[role="menu"]:not([data-state="closed"]), [aria-haspopup][aria-expanded="true"], [role="textbox"][aria-expanded="true"]'
        ) ||
        ((shortcut === shortcuts.previous || shortcut === shortcuts.next) &&
            !!document.querySelector('.activity-day-popover[data-state="open"]'))
    )
}
