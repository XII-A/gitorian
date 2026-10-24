import { app, BrowserWindow, nativeTheme } from 'electron'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const scratch = process.env.WEEKLY_J_VERIFY_STATE
const output = process.env.WEEKLY_J_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify line-statistics with an owned disposable profile')
app.setPath('userData', join(scratch, 'profile'))
const fixture = JSON.parse(readFileSync(join(output, 'fixture.json'), 'utf8'))
let failPr = true
const requests = []
globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push({ method: init?.method ?? 'GET', path: url.pathname })
    writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
    if (url.hostname !== 'api.github.com' || !url.pathname.endsWith('/pulls/42/files'))
        throw new Error(`Unexpected fixture request: ${url.pathname}`)
    await new Promise((done) => setTimeout(done, 400))
    if (failPr) {
        failPr = false
        return new Response(JSON.stringify({ message: 'Fixture temporarily unavailable' }), { status: 404 })
    }
    return new Response(JSON.stringify(fixture.githubFiles))
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const record = (data) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...data }) + '\n')
let started = false
app.on('browser-window-created', (_, window) => {
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started || window.webContents.getURL().includes('reference=')) return
        started = true
        const js = (expression) => window.webContents.executeJavaScript(expression)
        const wait = async (expression, description = expression) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await js(expression)) {
                    record({ wait: description, passed: true })
                    return
                }
                await pause(60)
            }
            throw new Error(`Timed out: ${description}`)
        }
        const assert = async (expression, description) => {
            if (!(await js(expression))) throw new Error(description)
            record({ assert: description, passed: true })
        }
        const click = async (selector, text) => {
            record({ click: selector, text })
            const point = await js(`(() => {
                const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(element => ${JSON.stringify(text ?? '')} === '' || element.textContent.includes(${JSON.stringify(text ?? '')}))
                if (!element) throw new Error('Missing target: ' + ${JSON.stringify(selector)})
                element.scrollIntoView({block:'center'})
                const rect = element.getBoundingClientRect()
                return {x:Math.round(rect.x+rect.width/2), y:Math.round(rect.y+rect.height/2)}
            })()`)
            window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
            window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
            window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
            await pause(250)
        }
        const key = async (keyCode) => {
            record({ key: keyCode })
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
            if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
            await pause(250)
        }
        const shot = async (name) => {
            await pause(300)
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
            record({ screenshot: `${name}.png`, text: await js('document.body.innerText') })
        }
        const totalSelector = '.activity-files-heading .line-counts[aria-label="647 lines added, 45 lines deleted"]'
        const checkHierarchy = async (surface) => {
            const hierarchy = await js(`(() => {
                const scope=document.querySelector(${JSON.stringify(surface.startsWith('hub') ? '.hub-detail-dialog' : '.ws-inspector')})
                const style=selector=>{const node=scope.querySelector(selector);return node ? {color:getComputedStyle(node).color,weight:getComputedStyle(node).fontWeight} : undefined}
                const repository=style('.hub-detail-repository dd')
                const branch=style('.hub-detail-primary-branch'),author=style('.hub-detail-author-value'),date=style('.hub-detail-meta time')
                const headings=Array.from(scope.querySelectorAll('.hub-detail-section > h3,.activity-files-heading > h3')).map(node=>({text:node.textContent,color:getComputedStyle(node).color,weight:getComputedStyle(node).fontWeight}))
                const title=scope.querySelector('.ws-inspector-header h2')
                return {repository,branch,author,date,headings,
                    singleTitle:${surface.startsWith('hub')} || (!!title && scope.getAttribute('aria-labelledby')===title.id && !scope.querySelector('.ws-details-content h2'))}
            })()`)
            writeFileSync(join(output, `hierarchy-${surface}.json`), JSON.stringify(hierarchy, null, 2))
            if (
                !hierarchy.singleTitle ||
                hierarchy.headings.length < 2 ||
                hierarchy.headings.some(
                    (heading) => heading.color !== hierarchy.repository.color || heading.weight !== '500'
                ) ||
                hierarchy.branch?.color !== hierarchy.repository.color ||
                hierarchy.author?.color !== hierarchy.repository.color ||
                hierarchy.author?.weight !== '400' ||
                hierarchy.repository.weight !== '500' ||
                hierarchy.date?.color === hierarchy.repository.color
            )
                throw new Error(`${surface} hierarchy does not match the shared heading/value rules`)
            record({ assert: `${surface} headings and metadata use the agreed hierarchy`, passed: true })
        }
        const checkAlignment = async (surface) => {
            const alignment = await js(`(() => {
                const baseline = selector => {
                    const node = document.querySelector(selector)
                    const marker = document.createElement('span')
                    marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline'
                    node.append(marker)
                    const position = marker.getBoundingClientRect().top
                    marker.remove()
                    return position
                }
                const title = baseline('.activity-files-heading h3')
                const added = baseline('.activity-files-heading .line-additions')
                const deleted = baseline('.activity-files-heading .line-deletions')
                return {title,added,deleted,offset:Math.max(Math.abs(title-added),Math.abs(title-deleted))}
            })()`)
            record({ alignment: surface, ...alignment })
            writeFileSync(join(output, `alignment-${surface}.json`), JSON.stringify(alignment, null, 2))
            if (alignment.offset > 0.5)
                throw new Error(`${surface} title/count baselines differ by ${alignment.offset}px`)
        }
        const stateCaptures = []
        const captureStates = async (surface) => {
            await js(`document.querySelector('.activity-files-heading').scrollIntoView({block:'center'})`)
            const pointFor = (selector) =>
                js(
                    `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
                )
            const pointerClick = (point) => {
                window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
                window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
                window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
            }
            const capture = async (state) => {
                await pause(350)
                await checkAlignment(`${surface}-${state}`)
                const rect = await js(`(() => {
                    const row=document.querySelector('.activity-files-heading').getBoundingClientRect()
                    const popup=document.querySelector('.change-statistics-popover')?.getBoundingClientRect()
                    const x=Math.max(0,Math.floor(Math.min(row.x,popup?.x??row.x)-8))
                    const y=Math.max(0,Math.floor(Math.min(row.y,popup?.y??row.y)-8))
                    return {x,y,width:Math.ceil(Math.min(innerWidth,Math.max(row.right,popup?.right??row.right)+8)-x),height:Math.ceil(Math.min(innerHeight,Math.max(row.bottom,popup?.bottom??row.bottom)+8)-y)}
                })()`)
                const name = `${surface}-${state}.png`
                writeFileSync(join(output, name), (await window.webContents.capturePage(rect)).toPNG())
                stateCaptures.push({ surface, state, name, width: rect.width })
                record({ screenshot: name, state, surface, rect })
            }
            pointerClick(await pointFor('.activity-files-heading h3'))
            await wait(
                `!document.querySelector('.change-statistics-trigger').matches(':focus')`,
                `${surface} unfocused state`
            )
            await capture('unfocused')
            window.webContents.sendInputEvent({ type: 'mouseMove', ...(await pointFor('.change-statistics-trigger')) })
            await wait(
                `document.querySelector('.change-statistics-trigger').matches(':hover') && !document.querySelector('.change-statistics-trigger').matches(':focus')`,
                `${surface} hover without focus`
            )
            await capture('hover')
            pointerClick(await pointFor('.change-statistics-trigger'))
            await wait(`!!document.querySelector('.change-statistics-popover')`)
            await capture('open')
            await key('Escape')
            pointerClick(await pointFor('.activity-files-heading h3'))
        }
        const breakdown = async () => {
            await click('[aria-label="Show line change breakdown"]')
            await wait(`!!document.querySelector('.change-statistics-popover')`)
            await assert(
                `!document.querySelector('.change-statistics-popover').textContent.includes('Grouped by file path')`,
                'Breakdown omits the grouping description'
            )
            await assert(
                `Array.from(document.querySelectorAll('.change-statistics-table tbody tr')).map(row => row.textContent).join('|') === 'Runtime+55−7|Tests+77−1|Evals+503−36|Docs+10−0|Other+2−1'`,
                'All categories partition the expected line totals'
            )
            await assert(
                `document.querySelector('.change-statistics-table tfoot').textContent==='Total+647−45'`,
                'Breakdown total agrees with summary'
            )
        }
        const closeDialog = async () => {
            await click('.hub-detail-dialog [aria-label="Close dialog"]')
            await wait(`!document.querySelector('.hub-detail-dialog')`)
        }
        try {
            nativeTheme.themeSource = 'dark'
            await js(`document.documentElement.dataset.theme='dark'; true`)
            window.setSize(1440, 1000)
            await wait(`!!document.querySelector('.hub-activity')`)
            const initial = await js(`window.journal.invoke({type:'state'})`)
            const doctor = {
                url: window.webContents.getURL(),
                profile: app.getPath('userData'),
                electron: process.versions.electron,
                fixture:
                    'Real disposable Git commit; isolated GitHub file-metadata transport with one simulated failure',
                connections: initial.connections
            }
            if (
                doctor.profile !== join(scratch, 'profile') ||
                !doctor.url.startsWith(pathToFileURL(resolve('out/renderer/index.html')).href) ||
                initial.connections.github ||
                initial.connections.notion
            )
                throw new Error('Doctor rejected profile, build, or disconnected integration state')
            writeFileSync(join(output, 'doctor.json'), JSON.stringify(doctor, null, 2))
            await click('.hub-activity', 'Add reliable retry scheduling')
            await wait(`!!document.querySelector(${JSON.stringify(totalSelector)})`)
            await checkHierarchy('hub-commit')
            await shot('hub-commit-hierarchy')
            await checkAlignment('hub')
            await breakdown()
            await assert(
                `document.querySelector('.change-statistics-popover p').textContent.includes('1 binary file excluded')`,
                'Binary changes are excluded from text totals'
            )
            await shot('hub-commit-breakdown')
            await key('Escape')
            await js(
                `document.querySelector('.hub-detail-viewport').scrollTop = document.querySelector('.hub-detail-viewport').scrollHeight`
            )
            await shot('hub-commit-counts')
            await assert(
                `!document.querySelector('.change-statistics-popover') && document.activeElement.getAttribute('aria-label')==='Show line change breakdown'`,
                'Escape closes breakdown and restores focus'
            )
            await key('Enter')
            await wait(`!!document.querySelector('.change-statistics-popover')`)
            await key('Escape')
            await captureStates('hub')
            await closeDialog()
            await click('.hub-activity', 'Keep queued uploads safe')
            await wait(`!!document.querySelector('[aria-label="Loading changed files"]')`)
            await wait(`!!document.querySelector('.hub-detail-error-message')`)
            await assert(
                `!document.querySelector('[aria-label="Show line change breakdown"]')`,
                'Failed metadata never claims a zero total'
            )
            await shot('pr-load-error')
            await js(
                `Array.from(document.querySelectorAll('.hub-detail-dialog button')).find(button=>button.textContent==='Retry details').click()`
            )
            record({ click: 'Retry details' })
            await wait(`!!document.querySelector(${JSON.stringify(totalSelector)})`)
            await breakdown()
            await shot('hub-pr-breakdown')
            await key('Escape')
            await js(
                `document.querySelector('.hub-detail-viewport').scrollTop = document.querySelector('.hub-detail-viewport').scrollHeight`
            )
            await shot('hub-pr-counts')
            await checkHierarchy('hub-pr')
            await js(
                `Array.from(document.querySelectorAll('.hub-detail-dialog button')).find(button=>button.textContent.includes('Open in workspace')).click()`
            )
            await wait(`!!document.querySelector('.ws-details-content')`)
            await checkHierarchy('workspace-pr')
            await assert(
                `!!document.querySelector('.ws-inspector-header [aria-label="Current status: Open"]')`,
                'PR status remains in the persistent header'
            )
            await shot('workspace-pr-hierarchy')
            await window.loadURL(window.webContents.getURL().split('?')[0])
            await wait(`!!document.querySelector('.hub-activity')`)
            await click('.hub-activity', 'Keep queued uploads safe')
            await wait(`!!document.querySelector(${JSON.stringify(totalSelector)})`)
            nativeTheme.themeSource = 'light'
            // Explicit visual fixture; OS appearance no longer selects the app theme.
            await js(`document.documentElement.dataset.theme='light'; true`)
            await breakdown()
            await shot('hub-pr-light')
            // Read rendered sRGB pairs through Canvas; retain measured ratios for the UI review.
            const contrastExpression = `(() => {
                const context = document.createElement('canvas').getContext('2d', {willReadFrequently:true})
                const rgb = color => {context.clearRect(0,0,1,1); context.fillStyle=color; context.fillRect(0,0,1,1); return Array.from(context.getImageData(0,0,1,1).data).slice(0,3)}
                const luminance = channels => channels.map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,index)=>sum+v*[0.2126,0.7152,0.0722][index],0)
                return ['.line-additions','.line-deletions'].map(selector=>{
                    const node=document.querySelector('.change-statistics-popover '+selector)
                    const foreground=getComputedStyle(node).color,background=getComputedStyle(node.closest('.change-statistics-popover')).backgroundColor
                    const a=luminance(rgb(foreground)),b=luminance(rgb(background))
                    return {selector,foreground,background,fontFamily:getComputedStyle(node).fontFamily,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)}
                })
            })()`
            for (const theme of ['light', 'dark']) {
                nativeTheme.themeSource = theme
                await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; true`)
                await pause(100)
                const contrast = await js(contrastExpression)
                writeFileSync(join(output, `contrast-${theme}.json`), JSON.stringify(contrast, null, 2))
                if (contrast.some((pair) => pair.ratio < 4.5)) throw new Error('Line count text fails 4.5:1 contrast')
            }
            nativeTheme.themeSource = 'light'
            // Explicit visual fixture; OS appearance no longer selects the app theme.
            await js(`document.documentElement.dataset.theme='light'; true`)
            await key('Escape')
            window.setMinimumSize(320, 640)
            window.setSize(390, 850)
            await pause(300)
            await breakdown()
            await assert(
                `(() => {const r=document.querySelector('.change-statistics-popover').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`,
                'Narrow popover stays inside the viewport'
            )
            await shot('hub-pr-narrow')
            await key('Escape')
            window.setSize(320, 850)
            await breakdown()
            await assert(
                `(() => {const r=document.querySelector('.change-statistics-popover').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`,
                'Breakdown reflows at 320px'
            )
            await shot('hub-pr-320')
            await key('Escape')
            window.setSize(1440, 1000)
            window.webContents.setZoomFactor(2)
            await breakdown()
            await assert(
                `(() => {const r=document.querySelector('.change-statistics-popover').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`,
                'Breakdown remains reachable at 200% zoom'
            )
            await shot('hub-pr-zoom')
            await key('Escape')
            window.webContents.setZoomFactor(1)
            nativeTheme.themeSource = 'dark'
            await js(`document.documentElement.dataset.theme='dark'; true`)
            await closeDialog()
            await click('.hub-activity', 'Add reliable retry scheduling')
            await wait(`!!document.querySelector(${JSON.stringify(totalSelector)})`)
            await js(
                `Array.from(document.querySelectorAll('.hub-detail-dialog button')).find(button=>button.textContent.includes('Open in workspace')).click()`
            )
            record({ click: 'Open in workspace' })
            await wait(`!!document.querySelector('.ws-details-content')`)
            await checkHierarchy('workspace-commit')
            await assert(
                `document.querySelector('.hub-detail-commit-message').textContent.includes(document.querySelector('.ws-inspector-title').textContent)`,
                'The source commit message is preserved even when it repeats the subject'
            )
            await shot('workspace-commit-hierarchy')
            await checkAlignment('workspace')
            await assert(
                `!!document.querySelector(${JSON.stringify(totalSelector)})`,
                'Workspace uses the same persisted activity total'
            )
            await breakdown()
            await shot('workspace-details')
            await key('Escape')
            await js(
                `(() => {const viewport = document.querySelector('.ws-inspector [role="region"][aria-label="Activity details"]'); viewport.scrollTop=viewport.scrollHeight})()`
            )
            await shot('workspace-counts')
            const headingPoint = await js(`(() => {
                const rect = document.querySelector('.ws-details-content .activity-files-heading h3').getBoundingClientRect()
                return {x:Math.round(rect.x + rect.width / 2), y:Math.round(rect.y + rect.height / 2)}
            })()`)
            window.webContents.sendInputEvent({ type: 'mouseMove', ...headingPoint })
            window.webContents.sendInputEvent({ type: 'mouseDown', ...headingPoint, button: 'left', clickCount: 1 })
            window.webContents.sendInputEvent({ type: 'mouseUp', ...headingPoint, button: 'left', clickCount: 1 })
            await assert(
                `!document.querySelector('.change-statistics-trigger').matches(':focus')`,
                'Clicking the heading clears the line-count button focus'
            )
            await shot('workspace-counts-unfocused')
            await captureStates('workspace')
            await click('.ws-inspector [role="tab"][data-value="diff"]')
            await wait(`!!document.querySelector('.ws-file-heading')`)
            // Search and select through the real changed-file tree.
            const selectFile = async (path, expected) => {
                await click('.changed-file-picker [role="combobox"]')
                await wait(`!!document.querySelector('input[aria-label="Search changed file"]')`)
                await js(`document.querySelector('input[aria-label="Search changed file"]').focus()`)
                window.webContents.insertText(path)
                await pause(300)
                await click(`[role="treeitem"][title="${path}"]`)
                await wait(`document.querySelector('.ws-file-heading code')?.textContent===${JSON.stringify(path)}`)
                await assert(
                    expected === null
                        ? `document.querySelector('.ws-file-heading .line-counts-note')?.textContent==='Binary'`
                        : `document.querySelector('.ws-file-heading .line-counts')?.getAttribute('aria-label')===${JSON.stringify(expected)}`,
                    `Selected-file counts: ${path}`
                )
            }
            await selectFile('src/retry.ts', '55 lines added, 7 lines deleted')
            await shot('selected-file-diff')
            await selectFile('tests/retry.test.ts', '77 lines added, 1 line deleted')
            await shot('selected-test-diff')
            await selectFile('assets/retry.bin', null)
            await wait(`!!document.querySelector('.ws-file-diff .ws-diff-state [data-variant="plain"]')`)
            await pause(350)
            await assert(
                `(() => {
                const viewport=document.querySelector('.ws-file-diff .ws-diff-state-viewport')
                const content=viewport.firstElementChild
                const frame=viewport.getBoundingClientRect(),state=content.getBoundingClientRect()
                return content.textContent.includes('Binary file') && Math.abs(state.y+state.height/2-frame.y-frame.height/2)<4 && Math.abs(state.x+state.width/2-frame.x-frame.width/2)<4
            })()`,
                'Binary file uses the centered plain diff empty state'
            )
            await shot('selected-binary-diff')
            await selectFile('src/renamed.ts', '0 lines added, 0 lines deleted')
            await wait(
                `!!document.querySelector('.ws-file-diff .ws-diff-state') && document.querySelector('.ws-file-diff .ws-diff-state').textContent.includes('No text changes')`
            )
            await click('.ws-inspector [role="tab"][data-value="details"]')
            await click('[aria-label="Pop out diff"]')
            let reference
            for (let attempt = 0; attempt < 50; attempt++) {
                reference = BrowserWindow.getAllWindows().find((candidate) =>
                    candidate.webContents.getURL().includes('reference=activity')
                )
                if (
                    reference &&
                    (await reference.webContents.executeJavaScript(
                        `!!document.querySelector(${JSON.stringify(totalSelector)})`
                    ))
                )
                    break
                await pause(100)
            }
            if (
                !reference ||
                !(await reference.webContents.executeJavaScript(
                    `!!document.querySelector(${JSON.stringify(totalSelector)})`
                ))
            )
                throw new Error('Detached reference lost the line totals')
            reference.show()
            await pause(350)
            writeFileSync(join(output, 'detached-details.png'), (await reference.webContents.capturePage()).toPNG())
            record({
                assert: 'Detached reference preserves the commit total',
                passed: true,
                screenshot: 'detached-details.png'
            })
            await reference.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Dock back to workspace"]').click()`
            )
            await wait(`!!document.querySelector('[aria-label="Pop out diff"]')`)
            // Reload the renderer and reopen persisted metadata without requesting PR files again.
            const before = requests.length
            await window.loadURL(window.webContents.getURL().split('?')[0])
            await wait(`!!document.querySelector('.hub-activity')`)
            await click('.hub-activity', 'Keep queued uploads safe')
            await wait(`!!document.querySelector(${JSON.stringify(totalSelector)})`)
            if (requests.length !== before)
                throw new Error('Cached PR metadata unexpectedly refetched after renderer reload')
            await shot('persisted-pr-reopened')
            await closeDialog()
            await click('.hub-activity', 'Initial scheduler')
            await wait(
                `!!document.querySelector('.activity-files-heading .line-counts[aria-label="46 lines added, 0 lines deleted"]')`
            )
            await shot('root-commit-counts')
            await closeDialog()
            await click('.hub-activity', 'Record scheduler rollout checkpoint')
            await wait(
                `!!document.querySelector('.activity-files-heading .line-counts[aria-label="0 lines added, 0 lines deleted"]')`
            )
            await assert(
                `document.querySelector('.hub-detail-dialog').textContent.includes('No changed files')`,
                'A confirmed empty commit reports zero and no files'
            )
            await shot('empty-commit-counts')
            const comparison = (source) =>
                `<!doctype html><html lang="en"><meta charset="utf-8"><title>Line-count alignment</title><style>body{margin:0;font:14px/1.5 system-ui;color:var(--foreground,#eee)}h2{font-size:18px;font-weight:500;margin:20px 0 10px}section:first-child h2{margin-top:0}figure{margin:0 0 12px}figcaption{color:var(--muted-foreground,#aaa);margin-bottom:4px}img{display:block;max-width:100%;height:auto}</style><body>${[
                    'unfocused',
                    'hover',
                    'open'
                ]
                    .map(
                        (state) =>
                            `<section><h2>${{ unfocused: 'Unfocused', hover: 'Hover', open: 'Popover open' }[state]}</h2>${[
                                'workspace',
                                'hub'
                            ]
                                .map((surface) => {
                                    const item = stateCaptures.find(
                                        (item) => item.state === state && item.surface === surface
                                    )
                                    return `<figure><figcaption>${surface === 'workspace' ? 'Workspace panel' : 'Hub dialog'}</figcaption><img style="width:${item.width}px" alt="${surface} ${state}" src="${source(item)}"></figure>`
                                })
                                .join('')}</section>`
                    )
                    .join('')}</body></html>`
            const html = comparison(
                (item) => `data:image/png;base64,${readFileSync(join(output, item.name)).toString('base64')}`
            )
            writeFileSync(join(output, 'alignment-states.html'), html)
            writeFileSync(
                join(output, 'alignment-states-preview.html'),
                comparison((item) => join(output, item.name).replaceAll('\\', '/'))
            )
            const comparisonWindow = new BrowserWindow({
                show: false,
                width: 780,
                height: 2000,
                backgroundColor: '#171717',
                webPreferences: { offscreen: true }
            })
            await comparisonWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
            const comparisonHeight = await comparisonWindow.webContents.executeJavaScript('document.body.scrollHeight')
            comparisonWindow.setContentSize(780, Math.ceil(comparisonHeight))
            await pause(300)
            writeFileSync(
                join(output, 'alignment-states.png'),
                (await comparisonWindow.webContents.capturePage()).toPNG()
            )
            comparisonWindow.destroy()
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify(
                    {
                        passed: true,
                        checks: 'Commit/PR totals, category breakdown, binary exclusion, error/retry, pointer/keyboard, light/dark/narrow, selected runtime/test diff, persisted reopen',
                        transport: 'GitHub responses are an offline simulation; no external requests'
                    },
                    null,
                    2
                )
            )
            app.quit()
        } catch (error) {
            record({ failure: String(error) })
            console.error(error)
            try {
                await shot('failure')
            } catch {
                /* Keep the original journey failure if the window cannot be captured. */
            }
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify({ passed: false, error: String(error) }, null, 2)
            )
            process.exitCode = 1
            app.quit()
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
