/** Run against the sample workspace in Chromium. Catch delayed wrapping after clearing history. */
export const checkActivityFilterReset = async () => {
    const pause = (ms) =>
        Promise.resolve(
            (() => {
                const { promise, resolve, reject } = Promise.withResolvers()
                try {
                    setTimeout(resolve, ms)
                } catch (error) {
                    reject(error)
                }
                return promise
            })()
        )
    const filters = document.querySelector('.ws-activity-filters')
    const originalWidth = filters.style.width
    const waitFor = async (read, description) => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const value = read()
            if (value) {
                return value
            }
            await pause(20)
        }
        throw new Error(`History filter fixture did not become ready: ${description}`)
    }
    const choose = async (label, query, value) => {
        const field = [...document.querySelectorAll('[role="dialog"] label')].find((node) => node.textContent === label)
        const input = document.getElementById(field.htmlFor)
        input.focus()
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const option = await waitFor(
            () =>
                [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role="option"]')].find(
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
            [...filters.children].reduce((total, node) => total + node.getBoundingClientRect().width, 0) +
            Number(css.columnGap) * (filters.children.length - 1) +
            Number(css.paddingLeft) +
            Number(css.paddingRight) +
            0.25
        filters.style.width = `${width}px`
        document.querySelector('[aria-label="Browse branch history"]').click()
        await waitFor(() => document.querySelector('[role="dialog"]'), 'open dialog')
        await choose('Project', 'developer', 'developer-docs')
        await choose('Branch', 'main', 'main')
        const load = await waitFor(
            () =>
                [...document.querySelectorAll('[role="dialog"] button')].find(
                    (node) => node.textContent === 'Load branch history' && !node.disabled
                ),
            'enabled load button'
        )
        load.click()
        await waitFor(() => {
            const dialog = document.querySelector('[role="dialog"]')
            return !dialog || dialog.dataset.state === 'closed'
        }, 'close dialog')
        await pause(800)
        const button = document.querySelector('.ws-history-chip')
        const rows = []
        const started = performance.now()
        button.click()
        await (() => {
            const { promise, resolve, reject } = Promise.withResolvers()
            try {
                const sample = () => {
                    const row = Math.round(button.getBoundingClientRect().top - filters.getBoundingClientRect().top)
                    if (!rows.length || rows.at(-1).row !== row) {
                        rows.push({ row, time: Math.round(performance.now() - started) })
                    }
                    if (performance.now() - started < 1200) {
                        setTimeout(sample, 16)
                    } else {
                        resolve()
                    }
                }
                setTimeout(sample, 0)
            } catch (error) {
                reject(error)
            }
            return promise
        })()
        return { passed: rows.length === 1 && rows[0].row === 0, rows }
    } finally {
        filters.style.width = originalWidth
    }
}
