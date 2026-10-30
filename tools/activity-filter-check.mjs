/** Exercise stable filter geometry, hover-only scrollbars and the sample branch-history journey. */
export async function checkActivityFilterReset() {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const filters = document.querySelector('.ws-activity-filters')
    const originalWidth = filters.style.width
    const frame = document.querySelector('.ws-frame')
    const originalColumns = frame.style.gridTemplateColumns
    frame.style.gridTemplateColumns = '900px minmax(0, 1fr) 320px'
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
    const observations = []
    const row = filters.querySelector('.activity-filter-items')
    const viewport = filters.querySelector('.activity-filter-viewport')
    const checkRow = async (phase, width) => {
        filters.style.width = `${width}px`
        await waitFor(
            () => !!filters.querySelector('.activity-filter-arrow') === viewport.scrollWidth > viewport.clientWidth + 1,
            'overflow controls after resize'
        )
        const chips = Array.from(row.children).map((node) => node.getBoundingClientRect())
        const sameRow = chips.every((bounds) => Math.abs(bounds.top - chips[0].top) < 1)
        const overflowing = viewport.scrollWidth > viewport.clientWidth + 1
        const cues = !!filters.querySelector('.activity-filter-arrow')
        const result = { phase, width, sameRow, overflowing, cues, height: filters.getBoundingClientRect().height }
        observations.push(result)
        if (!sameRow || overflowing !== cues || (width === 760 && overflowing))
            throw new Error(`Filter row failed: ${JSON.stringify(result)}`)
    }
    const picker = () => filters.querySelector('.project-filter [role="combobox"]')
    const pickProject = async (label) => {
        const trigger = picker()
        trigger.focus()
        const id = trigger.getAttribute('aria-controls')
        trigger.click()
        const option = await waitFor(
            () =>
                Array.from(document.getElementById(id)?.querySelectorAll('[role="option"]') ?? []).find(
                    (node) => node.textContent.trim() === label && !node.closest('[inert]')
                ),
            'portaled project option'
        )
        if (!(option instanceof HTMLElement)) throw new Error('Project option is unavailable')
        await pause(500)
        const bounds = option.getBoundingClientRect()
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        if (option !== hit && !option.contains(hit))
            throw new Error('Project menu is clipped or covered by the scrolling toolbar')
        option.click()
        await waitFor(
            () => picker()?.getAttribute('aria-expanded') === 'false',
            'project menu closed and focus restored'
        )
        return document.activeElement === picker()
    }
    try {
        await pause(500)
        for (const width of [280, 320, 480, 760]) await checkRow('idle', width)
        filters.style.width = '320px'
        await pause(100)
        viewport.scrollLeft = 0
        await pause(1600)
        const atStart = {
            left: !!filters.querySelector('[aria-label="Scroll activity filters left"]'),
            right: !!filters.querySelector('[aria-label="Scroll activity filters right"]')
        }
        if (atStart.left || !atStart.right) throw new Error('Only the right arrow should exist at the start')
        const track = filters.querySelector('.activity-filter-scroll [data-axis="x"]')
        const scrollbarHiddenAtRest = track && Number(getComputedStyle(track).opacity) < 0.01
        if (!scrollbarHiddenAtRest) throw new Error('The scrollbar must remain hidden until the filter row is hovered')
        const geometry = () => {
            const view = viewport.getBoundingClientRect()
            return {
                left: view.left,
                width: view.width,
                contentOrigin: row.firstElementChild.getBoundingClientRect().left + viewport.scrollLeft
            }
        }
        const edgeGeometry = [geometry()]
        for (let page = 0; page < 12; page++) {
            const next = filters.querySelector('[aria-label="Scroll activity filters right"]')
            if (!next) break
            next.focus({ preventScroll: true })
            next.click()
            await pause(80)
            edgeGeometry.push(geometry())
        }
        const atEnd = {
            left: !!filters.querySelector('[aria-label="Scroll activity filters left"]'),
            right: !!filters.querySelector('[aria-label="Scroll activity filters right"]')
        }
        if (!atEnd.left || atEnd.right) throw new Error('Only the left arrow should exist at the end')
        const focusAfterArrowRemoval = document.activeElement === viewport
        if (!focusAfterArrowRemoval)
            throw new Error('Removing a focused edge arrow must retain focus in the filter row')
        viewport.scrollLeft = Math.max(1, (viewport.scrollWidth - viewport.clientWidth) / 2)
        await pause(100)
        const inMiddle = filters.querySelectorAll('.activity-filter-arrow').length === 2
        if (!inMiddle) throw new Error('Both directions must be available between the ends')
        const arrowGeometry = Array.from(filters.querySelectorAll('.activity-filter-arrow')).map((button) => {
            const bounds = button.getBoundingClientRect()
            const view = viewport.getBoundingClientRect()
            return {
                label: button.ariaLabel,
                center: bounds.y + bounds.height / 2,
                rowCenter: view.y + view.height / 2,
                height: bounds.height
            }
        })
        if (arrowGeometry.some((button) => Math.abs(button.center - button.rowCenter) > 1))
            throw new Error(`Filter arrows must share the chip row center: ${JSON.stringify(arrowGeometry)}`)
        edgeGeometry.push(geometry())
        viewport.scrollLeft = 0
        await pause(100)
        edgeGeometry.push(geometry())
        const geometryDrift = Math.max(
            ...edgeGeometry.flatMap((sample) => [
                Math.abs(sample.left - edgeGeometry[0].left),
                Math.abs(sample.width - edgeGeometry[0].width),
                Math.abs(sample.contentOrigin - edgeGeometry[0].contentOrigin)
            ])
        )
        if (geometryDrift > 1) throw new Error(`Edge arrows shifted or resized the chip viewport by ${geometryDrift}px`)
        const scrollbarHiddenAfterScroll = Number(getComputedStyle(track).opacity) < 0.01
        if (!scrollbarHiddenAfterScroll) throw new Error('Scrolling without hover must not reveal the scrollbar')
        const before = viewport.scrollLeft
        filters.querySelector('[aria-label="Scroll activity filters right"]').click()
        await waitFor(() => viewport.scrollLeft > before + 1, 'scroll arrow moves the filter row')
        // Focus reveals the trailing control without changing the vertical activity position.
        const history = filters.querySelector('.ws-history-chip')
        history.focus()
        await pause(100)
        const bounds = history.getBoundingClientRect(),
            view = viewport.getBoundingClientRect()
        const focusRevealed = bounds.left >= view.left - 1 && bounds.right <= view.right + 1
        if (!focusRevealed) throw new Error('Focused history filter remains clipped')
        history.click()
        await waitFor(() => document.querySelector('[role="dialog"]'), 'open history dialog')
        await choose('Project', 'developer', 'developer-docs')
        await choose('Branch', 'offline', 'feat/offline-queue')
        const load = await waitFor(
            () =>
                Array.from(document.querySelectorAll('[role="dialog"] button')).find(
                    (node) => node.textContent === 'Load branch history' && !node.disabled
                ),
            'load history'
        )
        load.click()
        await waitFor(
            () =>
                !document.querySelector('[role="dialog"]') ||
                document.querySelector('[role="dialog"]').getAttribute('data-state') === 'closed',
            'history dialog closed'
        )
        await pause(500)
        for (const width of [280, 320, 480, 760]) await checkRow('active-history', width)
        const active = filters.querySelector('.ws-history-chip')
        const nameRetained =
            active.title.includes('feat/offline-queue') &&
            active.getAttribute('aria-label').includes('feat/offline-queue')
        const label = active.querySelector('.ws-history-label')
        const labelStyle = getComputedStyle(label)
        const historySingleLine =
            label.getBoundingClientRect().height <= parseFloat(labelStyle.lineHeight) + 1 &&
            labelStyle.whiteSpace === 'nowrap' &&
            labelStyle.textOverflow === 'ellipsis'
        if (!historySingleLine) throw new Error('Long branch history labels must truncate on a single line')
        filters.style.width = '320px'
        const height = filters.getBoundingClientRect().height
        active.focus()
        active.click()
        await pause(500)
        const stableHeight = Math.abs(filters.getBoundingClientRect().height - height) < 1
        const projectRestoresFocus = await pickProject('developer-docs')
        const resetRestoresFocus = await pickProject('All Projects')
        const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
        viewport.dispatchEvent(wheel)
        const verticalWheelPreserved = !wheel.defaultPrevented
        return {
            passed:
                focusRevealed &&
                nameRetained &&
                stableHeight &&
                projectRestoresFocus &&
                resetRestoresFocus &&
                verticalWheelPreserved,
            observations,
            atStart,
            atEnd,
            inMiddle,
            arrowGeometry,
            historySingleLine,
            scrollbarHiddenAtRest,
            scrollbarHiddenAfterScroll,
            geometryDrift,
            edgeGeometry,
            focusAfterArrowRemoval,
            focusRevealed,
            nameRetained,
            stableHeight,
            projectRestoresFocus,
            resetRestoresFocus,
            verticalWheelPreserved
        }
    } finally {
        filters.style.width = originalWidth
        frame.style.gridTemplateColumns = originalColumns
    }
}
