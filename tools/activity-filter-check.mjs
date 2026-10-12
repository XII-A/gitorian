/** Run against the sample workspace in Chromium. Catch delayed wrapping after clearing history. */
export async function checkActivityFilterReset() {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const filters = document.querySelector('.ws-activity-filters')
    const originalWidth = filters.style.width
    const waitFor = async (read, description) => {
        for (let attempt = 0; attempt < 50; attempt++) {
            const value = read()
            if (value) return value
            await pause(20)
        }
        throw new Error(`History filter fixture did not become ready: ${description}`)
    }
    const choose = async (label, query, value) => {
        const field = Array.from(document.querySelectorAll('[role="dialog"] label')).find(
            (node) => node.textContent === label
        )
        const input = document.getElementById(field.htmlFor)
        input.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const option = await waitFor(
            () =>
                Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper] [role="option"]')).find(
                    (node) => node.textContent === value
                ),
            `${label} option`
        )
        option.click()
        await waitFor(
            () => input.value === value && input.getAttribute('aria-expanded') === 'false',
            `${label} selection`
        )
    }
    try {
        // Measure the unfiltered chips. Put the toolbar just above its first-row wrapping threshold.
        await pause(800)
        const css = getComputedStyle(filters)
        const width =
            Array.from(filters.children).reduce((total, node) => total + node.getBoundingClientRect().width, 0) +
            parseFloat(css.columnGap) * (filters.children.length - 1) +
            parseFloat(css.paddingLeft) +
            parseFloat(css.paddingRight) +
            0.25
        filters.style.width = `${width}px`
        document.querySelector('[aria-label="Browse branch history"]').click()
        await waitFor(() => document.querySelector('[role="dialog"]'), 'open dialog')
        await choose('Project', 'developer', 'developer-docs')
        await choose('Branch', 'main', 'main')
        const load = await waitFor(
            () =>
                Array.from(document.querySelectorAll('[role="dialog"] button')).find(
                    (node) => node.textContent === 'Load branch history' && !node.disabled
                ),
            'enabled load button'
        )
        load.click()
        await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]')
            return !dialog || dialog.getAttribute('data-state') === 'closed'
        }, 'close dialog')
        await pause(800)
        const button = document.querySelector('.ws-history-chip')
        const rows = []
        const started = performance.now()
        button.click()
        await new Promise((resolve) => {
            const sample = () => {
                const row = Math.round(button.getBoundingClientRect().top - filters.getBoundingClientRect().top)
                if (!rows.length || rows.at(-1).row !== row)
                    rows.push({ row, time: Math.round(performance.now() - started) })
                if (performance.now() - started < 1200) setTimeout(sample, 16)
                else resolve()
            }
            setTimeout(sample, 0)
        })
        return { passed: rows.length === 1 && rows[0].row === 0, rows }
    } finally {
        filters.style.width = originalWidth
    }
}
