/** Exercise grouped wrapping and delayed reflow through the sample branch-history journey. */
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
        const grouped = []
        const checkPair = (phase, available) => {
            filters.style.width = `${available}px`
            const project = filters.querySelector('.project-filter').getBoundingClientRect()
            const history = filters.querySelector('.ws-history-chip').getBoundingClientRect()
            const trigger = filters.querySelector('.project-filter [role="combobox"]').getBoundingClientRect()
            const bounds = filters.getBoundingClientRect()
            const together = Math.abs(project.top - history.top) < 1
            const fits =
                project.left >= bounds.left &&
                trigger.right <= history.left + 1 &&
                history.right <= bounds.right - parseFloat(css.paddingRight) + 1
            grouped.push({ phase, width: available, together, fits, projectTop: project.top, historyTop: history.top })
        }
        for (const available of [280, 320, width - 1, width + 1]) checkPair('idle', available)
        filters.style.width = `${width}px`
        document.querySelector('[aria-label="Browse branch history"]').click()
        await waitFor(() => document.querySelector('[role="dialog"]'), 'open dialog')
        await choose('Project', 'developer', 'developer-docs')
        await choose('Branch', 'offline', 'feat/offline-queue')
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
        for (const available of [280, 320, width - 1, width + 1]) checkPair('active', available)
        const active = filters.querySelector('.ws-history-chip')
        const nameRetained =
            active.title.includes('feat/offline-queue') &&
            active.getAttribute('aria-label').includes('feat/offline-queue')
        filters.style.width = `${width}px`
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
        filters.style.width = '320px'
        const picker = filters.querySelector('.project-filter [role="combobox"]')
        picker.click()
        const option = await waitFor(
            () =>
                Array.from(document.querySelectorAll('.project-filter [role="option"]')).find(
                    (node) => node.textContent.trim() === 'developer-docs'
                ),
            'toolbar project option'
        )
        if (!(option instanceof HTMLElement)) throw new Error('Project option is unavailable')
        await pause(400)
        const optionBounds = option.getBoundingClientRect()
        const hit = document.elementFromPoint(
            optionBounds.x + optionBounds.width / 2,
            optionBounds.y + optionBounds.height / 2
        )
        const menuReachable = option === hit || option.contains(hit)
        option.click()
        await waitFor(
            () => picker.title === 'developer-docs' && picker.getAttribute('aria-expanded') === 'false',
            'toolbar project selected'
        )
        await pause(400)
        checkPair('selected-project', 320)
        picker.click()
        const all = await waitFor(
            () =>
                Array.from(document.querySelectorAll('.project-filter [role="option"]')).find(
                    (node) => node.textContent.trim() === 'All Projects'
                ),
            'all projects option'
        )
        all.click()
        await waitFor(
            () => picker.title === 'All projects' && picker.getAttribute('aria-expanded') === 'false',
            'toolbar project reset'
        )
        return {
            passed:
                menuReachable &&
                grouped.every((item) => item.together && item.fits) &&
                nameRetained &&
                rows.length === 1 &&
                rows[0].row === 0,
            grouped,
            menuReachable,
            nameRetained,
            rows
        }
    } finally {
        filters.style.width = originalWidth
    }
}
