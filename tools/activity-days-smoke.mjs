import { app, dialog } from 'electron'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const scratch = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify activity-days')
app.setPath('userData', join(scratch, 'profile'))
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const repository = join(scratch, 'busy-week')
mkdirSync(repository)
const git = (...args) => execFileSync('git', args, { cwd: repository, windowsHide: true, stdio: 'ignore' })
git('init', '-b', 'main')
git('config', 'user.name', 'Fixture author')
git('config', 'user.email', 'fixture@example.com')
const monday = new Date()
monday.setUTCHours(12, 0, 0, 0)
monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7)
/** @param {number} offset */
const day = (offset) => {
    const date = new Date(monday)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
}
for (const [offset, count] of [
    [0, 120],
    [1, 5],
    [6, 7]
]) {
    for (let index = 0; index < count; index++) {
        const date = `${day(offset)}T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`
        execFileSync('git', ['commit', '--allow-empty', '-m', `Day ${offset} activity ${index + 1}`], {
            cwd: repository,
            windowsHide: true,
            stdio: 'ignore',
            env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
        })
    }
}
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repository] })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        const js = (source) => window.webContents.executeJavaScript(source)
        const record = (action, result) =>
            appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ action, result }) + '\n')
        const wait = async (source) => {
            for (let i = 0; i < 200; i++) {
                if (await js(source)) return
                await pause(40)
            }
            throw new Error(`Timed out: ${source}`)
        }
        const shot = async (name) => writeFileSync(join(output, name), (await window.webContents.capturePage()).toPNG())
        /** @param {number | 'all'} offset */
        const chooseDay = async (offset) => {
            await wait(`!!document.querySelector('.activity-day-filter button[role="combobox"]')`)
            const listId = await js(
                `document.querySelector('.activity-day-filter [role="combobox"]').getAttribute('aria-controls')`
            )
            await js(`document.querySelector('.activity-day-filter [role="combobox"]').focus()`)
            await js(`document.querySelector('.activity-day-filter [role="combobox"]').click()`)
            await wait(`!document.getElementById(${JSON.stringify(listId)})?.closest('[inert]')`)
            await pause(500)
            await js(
                `document.getElementById(${JSON.stringify(listId)}).querySelectorAll('[role="option"]')[${offset === 'all' ? 0 : offset + 1}].click()`
            )
            await wait(
                `document.querySelector('.activity-day-filter [role="combobox"]')?.getAttribute('aria-expanded')==='false'`
            )
        }
        try {
            window.webContents.debugger.attach('1.3')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
            })
            await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
            const initial = await js(
                `window.journal.invoke({type:'state'}).then(r=>({repositories:r.state.repositories.length,activities:r.state.activities.length,remote:r.connections.remote,notion:r.connections.notion}))`
            )
            assert.deepEqual(initial, { repositories: 0, activities: 0, remote: false, notion: false })
            assert.equal(app.getPath('userData'), join(scratch, 'profile'))
            assert.ok(window.webContents.getURL().startsWith(pathToFileURL(resolve('out/renderer/index.html')).href))
            writeFileSync(
                join(output, 'doctor.json'),
                JSON.stringify(
                    { pid: process.pid, profile: app.getPath('userData'), url: window.webContents.getURL(), initial },
                    null,
                    2
                )
            )
            record('Fixture import through real preload IPC', await js(`window.journal.invoke({type:'addRepository'})`))
            await js(`localStorage.setItem('gitorian:onboarding:v1:local','dismissed')`)
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(`${base}?week=${day(0)}`)
            await wait(`!!document.querySelector('[aria-label="Dismiss setup"]')`)
            await js(`document.querySelector('[aria-label="Dismiss setup"]').click()`)
            await wait(`document.querySelectorAll('.hub-day').length===3`)
            const state = await js(
                `window.journal.invoke({type:'state'}).then(r=>({activities:r.state.activities.length,timezone:r.state.settings.timezone}))`
            )
            assert.equal(state.activities, 132)
            record('Real previous-week Git acquisition', state)
            for (const surface of ['hub', 'workspace']) {
                if (surface === 'workspace') {
                    await js(`document.querySelector('[aria-label="Open journal"]').click()`)
                    await wait(`!!document.querySelector('.ws-activity-filters')`)
                }
                const group = surface === 'hub' ? '.hub-day' : '.ws-day-group'
                const rows = surface === 'hub' ? '.hub-activity' : '.ws-activity-row'
                const toolbar = surface === 'hub' ? '.hub-filters' : '.ws-activity-filters'
                await js(`document.querySelector('${toolbar}').style.width='320px'`)
                await wait(
                    `(()=>{const strip=document.querySelector('${toolbar}');return strip?.getBoundingClientRect().width<=321&&!!strip.querySelector('[aria-label="Scroll activity filters right"]')})()`
                )
                assert.ok(
                    await js(
                        `(()=>{const strip=document.querySelector('${toolbar}');const rects=Array.from(strip.querySelector('.activity-filter-items').children).map(n=>n.getBoundingClientRect());return rects.every(r=>Math.abs(r.top-rects[0].top)<1)&&!!strip.querySelector('[aria-label="Scroll activity filters right"]')})()`
                    ),
                    `${surface} filters must stay in one row with visible overflow arrows`
                )
                await js(
                    `(()=>{const view=document.querySelector('${toolbar} .activity-filter-viewport');view.scrollLeft=(view.scrollWidth-view.clientWidth)/2})()`
                )
                await wait(`document.querySelectorAll('${toolbar} .activity-filter-arrow').length===2`)
                const arrowAlignment = await js(
                    `(()=>{const strip=document.querySelector('${toolbar}'),view=strip.querySelector('.activity-filter-viewport').getBoundingClientRect();return Array.from(strip.querySelectorAll('.activity-filter-arrow')).map(button=>{const r=button.getBoundingClientRect();return {label:button.ariaLabel,offset:r.y+r.height/2-view.y-view.height/2,inScrollbar:!!button.closest('[data-axis]'),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button}})})()`
                )
                assert.ok(
                    arrowAlignment.every((button) => Math.abs(button.offset) <= 1 && !button.inScrollbar && button.hit),
                    `${surface} arrows must align with the chips and remain reachable outside the scrollbar`
                )
                record(`${surface}: aligned arrow overlays`, arrowAlignment)
                await shot(`${surface}-filter-arrows.png`)
                await js(`document.querySelector('${toolbar} .activity-filter-viewport').scrollLeft=0`)
                const dayList = await js(
                    `document.querySelector('.activity-day-filter [role="combobox"]').getAttribute('aria-controls')`
                )
                await js(
                    `document.querySelector('.activity-day-filter [role="combobox"]').focus();document.querySelector('.activity-day-filter [role="combobox"]').click()`
                )
                await wait(
                    `!!document.getElementById(${JSON.stringify(dayList)})&&!document.getElementById(${JSON.stringify(dayList)}).closest('[inert]')`
                )
                await pause(500)
                assert.ok(
                    await js(
                        `(()=>{const list=document.getElementById(${JSON.stringify(dayList)}),option=list.querySelectorAll('[role="option"]')[7],r=option.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !document.querySelector('${toolbar}').contains(list)&&(hit===option||option.contains(hit))})()`
                    ),
                    `${surface} day menu must escape the scroll clip and remain reachable`
                )
                await shot(`${surface}-filter-menu.png`)
                await js(
                    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`
                )
                await wait(`!!document.querySelector('.activity-day-filter [role="combobox"]')`)
                await js(
                    `document.querySelector('${toolbar}').style.width='';document.querySelector('${toolbar} .activity-filter-viewport').scrollLeft=0`
                )
                record(`${surface}: single-row scrolling filters and reachable portaled day menu`, true)
                const mondayGroup = `${group}:has([aria-label*="115 more"])`
                assert.deepEqual(
                    await js(
                        `Array.from(document.querySelectorAll('${group}')).map(g=>g.querySelectorAll('${rows}').length).sort((a,b)=>a-b)`
                    ),
                    [5, 5, 5]
                )
                assert.equal(await js(`document.querySelectorAll('${group} .activity-day-toggle').length`), 2)
                assert.ok(
                    await js(
                        `Array.from(document.querySelectorAll('${group} > :first-child')).every(header=>!/[0-9]+ activit/.test(header.textContent))`
                    ),
                    'Day headings must not include activity counts'
                )
                assert.ok(
                    await js(
                        `!!(document.querySelector('.activity-day-filter').compareDocumentPosition(document.querySelector('.project-filter')) & Node.DOCUMENT_POSITION_FOLLOWING)`
                    ),
                    'Day filter must precede Projects'
                )
                if (surface === 'hub')
                    assert.ok(
                        await js(
                            `(()=>{const filters=document.querySelector('.hub-filters');const type=filters.querySelectorAll('.hub-filter-chip')[2].getBoundingClientRect();const day=filters.querySelector('.activity-day-filter').getBoundingClientRect();return day.left-type.right<=8})()`
                        ),
                        'Hub filters must have a shared compact gap'
                    )
                const beforeSummary =
                    surface === 'hub' ? await js(`document.querySelector('.hub-stats').textContent`) : null
                await pause(600)
                // Hover between the unchanged preview rows while a day changes height.
                // A resize elsewhere in the list must not cancel the shared glide.
                /** @type {Array<{phase: string, start: number, target: number, frames: Array<{time: number, y: number}>}>} */
                const hoverDuringDisclosure = await js(`(async()=>{
                    const group=document.querySelector('${group}:has([aria-label*="2 more"])');
                    group.scrollIntoView({block:'start',behavior:'instant'});
                    const rows=group.querySelectorAll('${rows}'), trigger=group.querySelector('.activity-day-toggle');
                    const highlight=group.closest('.activity-hover').querySelector('.activity-hover-highlight');
                    const hover=row=>row.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse'}));
                    const y=()=>highlight.getBoundingClientRect().top;
                    hover(rows[0]); await new Promise(r=>setTimeout(r,200));
                    const observations=[];
                    for(const phase of ['expand','collapse']){
                        trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
                        await new Promise(r=>setTimeout(r,50));
                        hover(rows[0]); await new Promise(r=>setTimeout(r,50));
                        const start=y(), target=rows[1].getBoundingClientRect().top, frames=[];
                        hover(rows[1]);
                        await new Promise(resolve=>{const began=performance.now();const sample=()=>{
                            frames.push({time:performance.now()-began,y:y()});
                            if(performance.now()-began<250)requestAnimationFrame(sample);else resolve();
                        };requestAnimationFrame(sample)});
                        observations.push({phase,start,target,frames});
                        await new Promise(r=>setTimeout(r,650));
                    }
                    return observations;
                })()`)
                writeFileSync(
                    join(output, `${surface}-disclosure-hover.json`),
                    JSON.stringify(hoverDuringDisclosure, null, 2)
                )
                for (const observation of hoverDuringDisclosure)
                    assert.ok(
                        observation.frames.filter(
                            (frame) => frame.y > observation.start + 1 && frame.y < observation.target - 1
                        ).length >= 3,
                        `${surface}: row hover must glide during ${observation.phase}, rather than snap on a list resize`
                    )
                await js(`document.querySelector('${mondayGroup}').scrollIntoView({block:'start'})`)
                await shot(`${surface}-previews.png`)
                await js(`document.querySelector('${mondayGroup} .activity-day-toggle').click()`)
                await wait(
                    `document.querySelector('${group}:has([aria-label*="Show fewer"])').querySelectorAll('${rows}').length===120`
                )
                await pause(650)
                assert.equal(
                    await js(
                        `document.querySelector('${group}:has([aria-label*="Show fewer"]) [role="region"]').inert`
                    ),
                    false
                )
                // Close from the actual visible trailing control, including viewport motion.
                const point = await js(`(() => {
                    const trigger=document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle');
                    trigger.scrollIntoView({block:'center',behavior:'instant'});
                    const root=trigger.closest('.activity-day-rows'), viewport=root.closest('[role="region"]');
                    const panel=document.getElementById(trigger.getAttribute('aria-controls'));
                    const height=panel.getBoundingClientRect().height, start=viewport.scrollTop;
                    const target=Math.min(Math.max(0,viewport.scrollHeight-viewport.clientHeight-height),Math.max(0,start+root.getBoundingClientRect().top-viewport.getBoundingClientRect().top));
                    const frames=[]; const started=performance.now();
                    window.__collapseProbe=new Promise(resolve=>{
                        const sample=()=>{
                            frames.push({time:performance.now()-started,height:panel.getBoundingClientRect().height,scroll:viewport.scrollTop,trigger:trigger.getBoundingClientRect().top});
                            if(performance.now()-started<1000)requestAnimationFrame(sample);
                            else resolve({height,start,target,frames});
                        };sample();
                    });
                    const r=trigger.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
                })()`)
                window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
                window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
                /** @type {{height: number, start: number, target: number, frames: Array<{time: number, height: number, scroll: number, trigger: number}>}} */
                const collapse = await js('window.__collapseProbe')
                writeFileSync(join(output, `${surface}-collapse-motion.json`), JSON.stringify(collapse, null, 2))
                const drift = Math.max(
                    ...collapse.frames.map((frame) =>
                        Math.abs(
                            frame.scroll -
                                (collapse.target +
                                    ((collapse.start - collapse.target) * frame.height) / collapse.height)
                        )
                    )
                )
                record(`${surface}: full pointer collapse scroll/height synchronization`, { drift })
                assert.ok(drift < 2, `Closing scroll and panel height diverged by ${Math.round(drift)}px`)
                await shot(`${surface}-collapsed.png`)
                await js(
                    `document.querySelector('${mondayGroup} .activity-day-toggle').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}))`
                )
                await pause(650)
                // Record a real pointer-triggered collapse and rapid reversal, with intermediate heights.
                const heights = await js(`(async()=>{
                    const trigger=document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle');
                    const panel=document.getElementById(trigger.getAttribute('aria-controls'));
                    const values=[];
                    trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
                    for(let i=0;i<7;i++){await new Promise(r=>setTimeout(r,20));values.push(panel.getBoundingClientRect().height)}
                    trigger.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
                    await new Promise(r=>setTimeout(r,650));
                    return {values, final:panel.getBoundingClientRect().height,expanded:trigger.getAttribute('aria-expanded'),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
                })()`)
                record(`${surface}: animated collapse and interruption`, heights)
                assert.equal(heights.expanded, 'true')
                assert.ok(
                    heights.values.some((h) => h > 0 && h < heights.final - 1),
                    'Collapse must have intermediate heights and reverse to full height'
                )
                await chooseDay(6)
                assert.equal(await js(`document.querySelectorAll('${group}').length`), 1)
                assert.equal(await js(`document.querySelectorAll('${rows}').length`), 7)
                assert.equal(await js(`document.querySelectorAll('.activity-day-toggle').length`), 0)
                if (surface === 'hub')
                    assert.equal(await js(`document.querySelector('.hub-stats').textContent`), beforeSummary)
                await chooseDay('all')
                assert.equal(
                    await js(
                        `document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle').getAttribute('aria-expanded')`
                    ),
                    'true'
                )
                await js(
                    `document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle').click()`
                )
                await pause(100)
                assert.equal(await js(`document.querySelector('${mondayGroup} [role="region"]').inert`), true)
                if (surface === 'hub') {
                    window.setContentSize(1440, 1100)
                    await pause(100)
                    await js(`document.querySelector('.hub-scroll').firstElementChild.scrollTop=1000`)
                    await pause(100)
                    await js(`document.querySelector('.activity-day-filter [role="combobox"]').click()`)
                    await pause(500)
                    await js(`window.emptyDayDateFrames=new Promise(resolve=>{
                        const samples=[];let frames=0;
                        const sample=()=>{const field=document.querySelector('[aria-label^="Week:"]');
                            const bounds=field.getBoundingClientRect();const label=field.children[1].getBoundingClientRect();
                            samples.push({top:label.top-bounds.top,bottom:label.bottom-bounds.bottom});
                            if(++frames<100)requestAnimationFrame(sample);else resolve(samples);
                        };requestAnimationFrame(sample);
                    })`)
                }
                if (surface === 'hub') {
                    await js(
                        `Array.from(document.querySelectorAll('[role="option"]')).find(n=>n.textContent.includes('Thursday')).click()`
                    )
                } else await chooseDay(3)
                if (surface === 'hub') {
                    const frames = await js(`window.emptyDayDateFrames`)
                    writeFileSync(join(output, 'hub-empty-day-date-frames.json'), JSON.stringify(frames, null, 2))
                    assert.ok(
                        frames.length > 0 && frames.every((frame) => frame.top >= -1 && frame.bottom <= 1),
                        'Week label must stay inside its field when empty-day filtering clamps scrolling'
                    )
                }
                assert.ok(await js(`document.body.textContent.includes('No matching activity for Thursday')`))
                await js(
                    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Show all days').click()`
                )
                await wait(`document.querySelectorAll('${group}').length===3`)
                record(`${surface}: previews, full Sunday, expansion memory, empty day recovery and totals`, true)
                // Native keyboard activation retains focus and snaps the disclosure.
                window.focus()
                window.webContents.focus()
                await js(`document.querySelector('${mondayGroup} .activity-day-toggle').focus()`)
                window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
                window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
                window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
                await pause(100)
                assert.equal(await js(`document.activeElement.getAttribute('aria-expanded')`), 'true')
                assert.ok(await js(`getComputedStyle(document.activeElement).outlineStyle!=='none'`))
                await js(`document.activeElement.click()`)
                // Same interaction under reduced motion, then return to the normal preference.
                await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
                })
                await pause(100)
                await js(
                    `document.querySelector('${mondayGroup} .activity-day-toggle').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}))`
                )
                await pause(100)
                assert.equal(
                    await js(
                        `document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle').getAttribute('aria-expanded')`
                    ),
                    'true'
                )
                await js(
                    `document.querySelector('${group}:has([aria-label*="Show fewer"]) .activity-day-toggle').click()`
                )
                await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
                })
                await pause(200)
                record(`${surface}: keyboard and reduced motion`, true)
                // Week changes retire both the selected day and expanded previews.
                await chooseDay(6)
                for (const preset of ['This week', 'Last week']) {
                    await js(`document.querySelector('[aria-label^="Week:"]').click()`)
                    await wait(`!!document.querySelector('[aria-label="Presets"]')`)
                    await js(
                        `Array.from(document.querySelectorAll('[aria-label="Presets"] button')).find(b=>b.textContent===${JSON.stringify(preset)}).click()`
                    )
                    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Apply').click()`)
                    await pause(300)
                    await wait(`document.querySelector('.activity-day-filter [role="combobox"]').title==='All days'`)
                }
                await wait(`document.querySelectorAll('${group}').length===3`)
                assert.equal(
                    await js(
                        `document.querySelector('${mondayGroup} .activity-day-toggle').getAttribute('aria-expanded')`
                    ),
                    'false'
                )
                record(`${surface}: week selection resets day and disclosures`, true)
            }
            window.setMinimumSize(0, 0)
            window.setContentSize(390, 900)
            await pause(400)
            assert.ok(await js(`document.documentElement.scrollWidth<=window.innerWidth`))
            await shot('activity-days.png')
            record('390px workspace has no page overflow', true)
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify(
                    {
                        passed: true,
                        fixture: { week: day(0), days: [120, 5, 7], realGit: true },
                        surfaces: ['hub', 'workspace']
                    },
                    null,
                    2
                )
            )
            window.close()
        } catch (error) {
            console.error(error)
            await shot('failure.png')
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
