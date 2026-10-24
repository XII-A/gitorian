import { app, dialog, ipcMain } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

// Isolated desktop fixture. Never uses the person's journal, tokens, or providers.
mkdirSync(resolve('.ai-docs'), { recursive: true })
const appRoot = process.env.IMAGE_SMOKE_APP ?? '.'
const directory = mkdtempSync(resolve('.ai-docs/image-smoke-'))
app.setPath('userData', directory)
const day = new Date()
day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
const week = day.toISOString().slice(0, 10)
const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
const state = {
    version: 1,
    repositories: [],
    activities: [],
    drafts: [
        {
            id: 'image-smoke',
            week,
            title: 'Designs this week',
            body: empty,
            selections: [],
            updatedAt: new Date().toISOString()
        }
    ],
    entries: [],
    coverage: [],
    revisions: [],
    diffs: {},
    saves: [],
    settings: {
        weekStart: 1,
        timezone: 'UTC',
        refreshMinutes: 0,
        template: empty,
        githubLogin: '',
        layout: { order: ['activity', 'draft', 'details'], hidden: [], sizes: { activity: 24, draft: 46, details: 30 } }
    }
}
const database = new DatabaseSync(join(directory, 'gitorian.sqlite'))
database.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)')
database.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify(state))
database.close()
const png = await sharp(
    Buffer.from(
        '<svg width="1200" height="600"><rect width="1200" height="600" fill="#f4f1eb"/><rect x="100" y="200" width="280" height="160" rx="16" fill="#d1dfd1"/><rect x="800" y="200" width="280" height="160" rx="16" fill="#d3dceb"/><path d="M380 280H800" stroke="#3c4540" stroke-width="5"/><text x="170" y="295" font-size="32">Editor</text><text x="850" y="295" font-size="32">Journal</text><text x="410" y="150" font-size="42">Writing with images</text></svg>'
    )
)
    .png()
    .toBuffer()
const base64 = png.toString('base64')
const pickerFile = join(directory, 'system.png')
writeFileSync(pickerFile, png)
let imageChoice = [pickerFile]
let imagePickCount = 0
let smokeWindow

const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const assert = (value, message) => {
    if (!value) throw new Error(message)
}
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) =>
    originalHandle(
        channel,
        channel === 'journal:image-import'
            ? async (...args) => {
                  await pause(1500)
                  return handler(...args)
              }
            : handler
    )
let checking = false
const backup = join(directory, 'backup.json')
dialog.showSaveDialog = (_window, options) =>
    Promise.resolve({
        canceled: false,
        filePath: options?.defaultPath?.startsWith('journal-image.') ? join(directory, options.defaultPath) : backup
    })
dialog.showOpenDialog = async (_owner, options) => {
    if (options?.title !== 'Choose journal images') return { canceled: false, filePaths: [backup] }
    imagePickCount++
    assert(
        await smokeWindow.webContents.executeJavaScript(
            `!document.querySelector('[aria-label="Add blocks"]') && document.activeElement!==document.querySelector('.tiptap')`
        ),
        'Editor must leave typing and close the slash menu before the native picker'
    )
    await pause(2000)
    return { canceled: imageChoice.length === 0, filePaths: imageChoice }
}
dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false })
setTimeout(() => {
    console.error('Image smoke timed out')
    app.exit(1)
}, 120000).unref()
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    if (checking) return
    checking = true
    smokeWindow = window
    window.setContentSize(1560, 1000)
    window.webContents.debugger.attach('1.3')
    void window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    const cdp = (method, parameters = {}) => window.webContents.debugger.sendCommand(method, parameters)
    const viewport = (width, height = 900) =>
        cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const screenshot = async () => {
        await window.webContents.capturePage(undefined, { stayAwake: true })
        await pause(500)
        return (await window.webContents.capturePage(undefined, { stayAwake: true })).toPNG()
    }
    window.webContents.once('did-finish-load', async () => {
        const js = (expression) => window.webContents.executeJavaScript(expression)
        const wait = async (expression) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await js(expression)) return
                await pause(50)
            }
            throw new Error(`Not ready: ${expression}`)
        }
        try {
            await wait(`!!document.querySelector('[aria-label="Open journal"]')`)
            await js(`document.querySelector('[aria-label="Open journal"]').click()`)
            await wait(`!!document.querySelector('.tiptap[contenteditable="true"]')`)
            await js(
                `window.__smokeFile=()=>new File([Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0))],'system.png',{type:'image/png'});true`
            )
            const chooseImage = async () => {
                await js(`document.querySelector('.tiptap').focus()`)
                await cdp('Input.insertText', { text: '/ image' })
                await wait(`Array.from(document.querySelectorAll('[role="option"]')).some(b=>b.textContent==='Image')`)
                await js(
                    `Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent==='Image').click()`
                )
            }
            if (process.env.IMAGE_SMOKE_LIGHTBOX) {
                const source = process.env.IMAGE_SMOKE_LIGHTBOX
                if (source !== '1') imageChoice = [source]
                else {
                    const tall = join(directory, 'tall.png')
                    await sharp({ create: { width: 2400, height: 9000, channels: 3, background: '#d8efff' } })
                        .png()
                        .toFile(tall)
                    imageChoice = [tall]
                }
                await chooseImage()
                await wait(`!!document.querySelector('.journal-image-preview img')?.naturalWidth`)
                await js(`document.querySelector('.journal-image-preview').click()`)
                await wait(`!!document.querySelector('.journal-lightbox-stage img')?.naturalWidth`)
                await pause(200)
                const measure = () =>
                    js(
                        `(()=>{const stage=document.querySelector('.journal-lightbox-stage');const img=stage.querySelector('img');const a=stage.getBoundingClientRect(),b=img.getBoundingClientRect();return {zoom:document.querySelector('[aria-label="Image zoom"]').querySelectorAll('button')[1].getAttribute('aria-label'),natural:[img.naturalWidth,img.naturalHeight],image:[b.width,b.height],stage:[a.width,a.height],fits:b.left>=a.left-1&&b.top>=a.top-1&&b.right<=a.right+1&&b.bottom<=a.bottom+1,scrollbarsHidden:getComputedStyle(stage).scrollbarWidth==='none',controlsBottom:document.querySelector('.journal-lightbox-controls').getBoundingClientRect().bottom,scroll:[stage.scrollLeft,stage.scrollTop]}})()`
                    )
                const initial = await measure()
                console.info(JSON.stringify({ initial }))
                writeFileSync(join(directory, 'tall-fit.png'), await screenshot())
                assert(initial.fits, 'Tall image must open entirely within its stage')
                assert(initial.scrollbarsHidden, 'Lightbox scrollbars must be hidden')
                assert(initial.zoom.endsWith('%'), 'Automatic fitting must display its percentage')
                const step = async (direction, count = 1) => {
                    await js(
                        `(async()=>{for(let i=0;i<${count};i++){document.querySelector('[aria-label="Zoom ${direction}"]').click();await new Promise(done=>setTimeout(done,30))}})()`
                    )
                    return measure()
                }
                const firstStep = await step('in')
                assert(Math.abs(firstStep.image[1] / initial.image[1] - 1.25) < 0.01, 'Zoom in must scale by 1.25')
                assert(firstStep.zoom.endsWith('%'), 'Manual zoom must display a percentage')
                const reverseStep = await step('out')
                assert(Math.abs(reverseStep.image[1] - initial.image[1]) < 1, 'Zoom out must reverse zoom in')
                const minimum = await step('out', 20)
                assert(
                    Math.abs(minimum.image[1] / initial.image[1] - 0.25) < 0.01,
                    'Minimum zoom must be one quarter of fit'
                )
                assert(
                    await js(
                        `document.querySelector('[aria-label="Zoom out"]').getAttribute('aria-disabled')==='true'`
                    ),
                    'Zoom out must disable at the minimum'
                )
                const maximum = await step('in', 50)
                assert(
                    Math.abs(maximum.image[1] / maximum.natural[1] - 2) < 0.01,
                    'Maximum zoom must remain 200% of intrinsic size'
                )
                assert(
                    await js(`document.querySelector('[aria-label="Zoom in"]').getAttribute('aria-disabled')==='true'`),
                    'Zoom in must disable at 200%'
                )
                const beforeStep = await measure()
                await js(`document.querySelector('[aria-label="Zoom out"]').click()`)
                await pause(50)
                const afterStep = await measure()
                assert(
                    Math.abs(
                        (Number(beforeStep.scroll[1]) + beforeStep.stage[1] / 2) / beforeStep.image[1] -
                            (Number(afterStep.scroll[1]) + afterStep.stage[1] / 2) / afterStep.image[1]
                    ) < 0.01,
                    'Button zoom must preserve the viewed center'
                )
                await js(`document.querySelector('[aria-label="Fit image"]').click()`)
                await pause(50)

                await js(`document.querySelector('.journal-lightbox-stage img').click()`)
                await pause(100)
                const zoomed = await measure()
                assert(
                    Math.abs(zoomed.image[1] / initial.image[1] - 2) < 0.01,
                    'Clicking the fitted image must double its fitted size'
                )
                assert(Math.abs(zoomed.controlsBottom - initial.controlsBottom) < 1, 'Zoom must not move the controls')
                const point = await js(
                    `(()=>{const r=document.querySelector('.journal-lightbox-stage').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`
                )
                await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
                await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
                await cdp('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: point.x - 80,
                    y: point.y - 120,
                    button: 'left',
                    buttons: 1
                })
                await cdp('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: point.x - 80,
                    y: point.y - 120,
                    button: 'left',
                    clickCount: 1
                })
                const panned = await measure()
                assert(panned.scroll[1] > zoomed.scroll[1], 'Dragging must pan the zoomed image')
                assert(panned.image[1] === zoomed.image[1], 'Releasing a pan must not toggle zoom')
                await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
                await cdp('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    ...point,
                    button: 'left',
                    clickCount: 1
                })
                await pause(100)
                assert((await measure()).fits, 'Clicking a zoomed image must return to fit')
                await js(`document.querySelector('.journal-lightbox-image').focus()`)
                await cdp('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    text: '\r',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13
                })
                await cdp('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13
                })
                await pause(100)
                await screenshot()
                assert((await measure()).image[1] > initial.image[1], 'Image zoom must work from the keyboard')

                await js(`document.querySelector('[aria-label="Fit image"]').click()`)
                await pause(100)
                assert((await measure()).fits, 'Fit must restore the complete image')
                for (const width of [320, 390, 768, 1024, 1440]) {
                    await viewport(width)
                    await screenshot()
                    const resized = await measure()
                    console.info(JSON.stringify({ width, resized }))
                    assert(resized.fits, `Tall image clipped at ${width}px`)
                }
                console.info(JSON.stringify({ lightboxPassed: true, directory }))
                app.exit(0)
                return
            }
            if (process.env.IMAGE_SMOKE_REGRESSIONS) {
                const failures = []
                const check = (condition, message) => {
                    console.info(JSON.stringify({ check: message, passed: condition }))
                    if (!condition) failures.push(message)
                }
                await chooseImage()
                await wait(`document.querySelector('.journal-image-preview img')?.naturalWidth===1200`)
                check(
                    await js(`!document.querySelector('textarea[aria-label="Image caption"]')`),
                    'caption stays hidden after import'
                )
                await js(`document.querySelector('.journal-image-preview').click()`)
                await wait(`!!document.querySelector('.journal-lightbox-stage img')?.naturalWidth`)
                check(
                    await js(
                        `(()=>{const rect=document.querySelector('.journal-lightbox-controls').getBoundingClientRect();window.__imageControlsBottom=rect.bottom;return innerHeight-rect.bottom<=32})()`
                    ),
                    'lightbox controls stay at the viewport bottom'
                )
                await js(`document.querySelector('.journal-lightbox [aria-label="Fit image"]').focus()`)
                await wait(`!!document.querySelector('[role="tooltip"]')`)
                check(
                    await js(
                        `(()=>{const tip=document.querySelector('[role="tooltip"]');const bubble=tip.parentElement;const layer=bubble.closest('[data-radix-popper-content-wrapper]');return +getComputedStyle(layer??bubble).zIndex>+getComputedStyle(document.querySelector('.journal-lightbox')).zIndex})()`
                    ),
                    'lightbox tooltip paints above image'
                )
                writeFileSync(join(directory, 'tooltip-layering.png'), await screenshot())
                window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
                await wait(`!document.querySelector('[role="tooltip"]')`)
                await js(`document.querySelector('[aria-label="Close image viewer"]')?.click()`)
                await wait(`!document.querySelector('.journal-lightbox')`)
                check(
                    await js(`!document.querySelector('textarea[aria-label="Image caption"]')`),
                    'caption stays hidden after preview'
                )
                const svgBytes = process.env.IMAGE_SMOKE_SVG
                    ? readFileSync(process.env.IMAGE_SMOKE_SVG)
                    : Buffer.from(
                          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 254.5 225"><path fill="#2DBCAF" d="M0 0H254.5V225H0Z"/></svg>'
                      )
                await js(
                    `(()=>{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob(${JSON.stringify(svgBytes.toString('base64'))}),c=>c.charCodeAt(0))],'logo.svg',{type:'image/svg+xml'}));const host=document.querySelector('.tiptap');const rect=host.getBoundingClientRect();host.dispatchEvent(new DragEvent('drop',{dataTransfer:t,clientX:rect.left+20,clientY:rect.bottom+8,bubbles:true,cancelable:true}));})()`
                )
                await wait(`document.querySelectorAll('.journal-image-preview img').length===2`)
                await js(`document.querySelectorAll('.journal-image-preview img').forEach(i=>i.loading='eager')`)
                await wait(`Array.from(document.querySelectorAll('.journal-image-preview img')).every(i=>i.complete)`)
                const dimensions = await js(
                    `Array.from(document.querySelectorAll('.journal-image-preview img')).map(i=>({naturalWidth:i.naturalWidth,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height}))`
                )
                console.info(JSON.stringify({ dimensions }))
                check(
                    dimensions.every((i) => i.width > 20 && i.height > 20),
                    'viewBox-only SVG remains visible after drop'
                )
                writeFileSync(join(directory, 'svg-visible.png'), await screenshot())
                await js(`document.querySelectorAll('.journal-image-preview')[1].click()`)
                await wait(`document.querySelector('.journal-lightbox-stage img')?.naturalWidth===170`)
                check(
                    await js(
                        `Math.abs(document.querySelector('.journal-lightbox-controls').getBoundingClientRect().bottom-window.__imageControlsBottom)<1`
                    ),
                    'switching to a shorter image keeps controls in place'
                )
                await js(`document.querySelector('[aria-label="Close image viewer"]').click()`)
                await wait(`!document.querySelector('.journal-lightbox')`)

                await js(`document.querySelector('.journal-image-tools [aria-label="Edit caption"]').click()`)
                check(
                    await js(
                        `(()=>{const input=document.querySelector('textarea[aria-label="Image caption"]');return !!input && getComputedStyle(input).borderBottomWidth==='0px'})()`
                    ),
                    'caption opens explicitly without a bottom border'
                )
                await js(
                    `(()=>{const input=document.querySelector('textarea[aria-label="Image caption"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'A saved caption');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur()})()`
                )
                check(
                    await js(
                        `document.querySelector('textarea[aria-label="Image caption"]')?.value==='A saved caption'`
                    ),
                    'saved caption stays directly editable after blur'
                )
                await js(
                    `window.__captionField=document.querySelector('textarea[aria-label="Image caption"]');window.__captionField.focus();window.__captionField.setSelectionRange(2,2)`
                )
                await cdp('Input.insertText', { text: 'new ' })
                check(
                    await js(
                        `document.querySelector('textarea[aria-label="Image caption"]')===window.__captionField && window.__captionField.value==='A new saved caption' && window.__captionField.selectionStart===6`
                    ),
                    'typing at an existing caption position preserves the field and caret'
                )
                for (const character of 'and ') await cdp('Input.insertText', { text: character })
                check(
                    await js(
                        `window.__captionField.value==='A new and saved caption' && window.__captionField.selectionStart===10`
                    ),
                    'continued typing stays in the middle of the caption'
                )
                await js(
                    `(()=>{const input=window.__captionField;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()`
                )
                check(
                    await js(
                        `document.activeElement===window.__captionField && !!document.querySelector('textarea[aria-label="Image caption"]')`
                    ),
                    'clearing a caption keeps it editable until blur'
                )
                await js(`window.__captionField.blur()`)
                check(
                    await js(`!document.querySelector('textarea[aria-label="Image caption"]')`),
                    'empty caption hides after blur'
                )
                await js(`document.querySelector('.tiptap').focus()`)
                window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
                window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
                await cdp('Input.insertText', { text: '/ image' })
                await wait(`Array.from(document.querySelectorAll('[role="option"]')).some(b=>b.textContent==='Image')`)
                imageChoice = []
                const previousPicks = imagePickCount
                await js(
                    `Array.from(document.querySelectorAll('[role="option"]')).find(b=>b.textContent==='Image').click()`
                )
                await wait(`!document.querySelector('.journal-image-pending')`)
                check(imagePickCount === previousPicks + 1, 'slash command uses the native picker')
                check(await js(`!document.querySelector('input[type="file"]')`), 'Chromium file picker path is removed')
                check(
                    await js(
                        `document.activeElement===document.querySelector('.tiptap') && getComputedStyle(document.body).pointerEvents!=='none'`
                    ),
                    'cancelled native picker returns writing focus and pointer access'
                )
                writeFileSync(join(directory, 'regressions.png'), await screenshot())
                if (failures.length) throw new Error(failures.join('; '))
                console.info(JSON.stringify({ regressionsPassed: true, directory }))
                app.exit(0)
                return
            }
            // Exercise the real slash command, preload bridge and native picker import handler.
            await chooseImage()
            await wait(`!!document.querySelector('.journal-image-skeleton')`)
            await pause(150)
            assert(
                await js(
                    `(()=>{const box=document.querySelector('.journal-image-skeleton');const rect=box.getBoundingClientRect();return rect.height>=60&&rect.height<=80&&box.childElementCount===0&&getComputedStyle(box).animationName!=='none'})()`
                ),
                'Loading skeleton must be a compact pulsing block without text lines'
            )
            await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
            assert(
                await js(`getComputedStyle(document.querySelector('.journal-image-skeleton')).animationName==='none'`),
                'Loading block ignores reduced motion'
            )
            await cdp('Emulation.setEmulatedMedia', { features: [] })
            writeFileSync(join(directory, 'loading.png'), await screenshot())
            await wait(
                `document.querySelectorAll('.journal-image-preview img').length===1 && document.querySelector('.journal-image-preview img').naturalWidth===1200`
            )
            await wait(`!!document.querySelector('.journal-image-tools [aria-label="Edit caption"]')`)
            await js(`document.querySelector('.journal-image-tools [aria-label="Edit caption"]').click()`)
            await js(
                `(()=>{const field=document.querySelector('textarea[aria-label="Image caption"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Editor to journal flow');field.dispatchEvent(new Event('input',{bubbles:true}));})()`
            )
            await wait(`document.querySelector('.journal-image-preview img')?.alt==='Editor to journal flow'`)
            await js(
                `(()=>{const field=document.querySelector('textarea[aria-label="Image caption"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'A detailed caption explaining the new design and the relationship between the editor and the journal.');field.dispatchEvent(new Event('input',{bubbles:true}));field.closest('.journal-image-frame').style.maxWidth='140px';})()`
            )
            await wait(
                `(()=>{const field=document.querySelector('textarea[aria-label="Image caption"]');return field.scrollHeight<=field.clientHeight+2 && field.clientHeight>40})()`
            )
            await js(
                `(()=>{const field=document.querySelector('textarea[aria-label="Image caption"]');field.closest('.journal-image-frame').style.maxWidth='';Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Editor to journal flow');field.dispatchEvent(new Event('input',{bubbles:true}));})()`
            )
            await js(`document.querySelector('.journal-image-preview').click()`)
            await wait(`!!document.querySelector('.journal-lightbox')`)
            await pause(200)
            writeFileSync(join(directory, 'preview.png'), await screenshot())
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            await wait(`!document.querySelector('.journal-lightbox')`)
            const focusReturned = await js(`document.activeElement===document.querySelector('.journal-image-preview')`)
            assert(focusReturned, 'Preview did not restore keyboard focus')
            // Clipboard and file drop use real browser File objects through the editor handlers.
            await js(
                `(()=>{const transfer=new DataTransfer();transfer.items.add(window.__smokeFile());document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`
            )
            await wait(`document.querySelectorAll('.journal-image-preview img').length===2`)
            await js(
                `(()=>{const host=document.querySelector('.tiptap');const p=host.querySelector('p');p.scrollIntoView();const rect=p.getBoundingClientRect();const transfer=new DataTransfer();transfer.items.add(window.__smokeFile());host.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:rect.left+5,clientY:rect.top+5,bubbles:true,cancelable:true}));})()`
            )
            await wait(`document.querySelectorAll('.journal-image-preview img').length===3`)
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" rx="8" fill="#087c54"/><text x="15" y="38" fill="white" font-size="24">SVG</text></svg>'
            await js(
                `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(svg)}],'logo.svg',{type:'image/svg+xml'}));const zone=document.querySelector('[data-journal-drop-zone]');const rect=zone.getBoundingClientRect();const options={dataTransfer:transfer,clientX:rect.left+20,clientY:rect.bottom-8,bubbles:true,cancelable:true};zone.dispatchEvent(new DragEvent('dragover',options));})()`
            )
            await wait(`!!document.querySelector('.journal-image-drop-guide')`)
            writeFileSync(join(directory, 'drop-guide.png'), await screenshot())
            await js(
                `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(svg)}],'logo.svg',{type:'image/svg+xml'}));const zone=document.querySelector('[data-journal-drop-zone]');const rect=zone.getBoundingClientRect();zone.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:rect.left+20,clientY:rect.bottom-8,bubbles:true,cancelable:true}));})()`
            )
            await wait(`document.querySelectorAll('.journal-image-preview img').length===4`)
            await js(`document.querySelectorAll('.journal-image-preview img').forEach(i=>i.loading='eager')`)
            await wait(
                `Array.from(document.querySelectorAll('.journal-image-preview img')).some(i=>i.naturalWidth===100)`
            )
            await js(
                `Array.from(document.querySelectorAll('.journal-image-frame')).find(f=>f.querySelector('img')?.naturalWidth===100).querySelector('[aria-label="Image actions"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true,pointerType:'mouse'}))`
            )
            await wait(`!!document.querySelector('[role="menu"]')`)
            writeFileSync(join(directory, 'small-image-menu.png'), await screenshot())
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            await wait(`!document.querySelector('[role="menu"]')`)
            await js(
                `(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'bad.svg',{type:'image/svg+xml'}));document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`
            )
            await wait(
                `document.body.textContent.includes('Could not import image') && !document.querySelector('.journal-image-pending')`
            )
            assert(
                await js(
                    `document.querySelectorAll('.journal-image-preview img').length===4 && !document.querySelector('.tiptap').textContent.includes('Could not import')`
                ),
                'Failed import left error content in writing'
            )
            writeFileSync(join(directory, 'import-error.png'), await screenshot())
            await js(`document.querySelector('[aria-label="Dismiss notification"]').click()`)
            await pause(1400)
            writeFileSync(join(directory, 'writing.png'), await screenshot())
            const persisted = await js(`window.journal.invoke({type:'state'}).then(r=>r.state)`)
            assert(
                JSON.stringify(persisted).includes('assetId') && !JSON.stringify(persisted).includes(base64),
                'State contains image bytes or missed images'
            )
            await js(`window.journal.invoke({type:'export'})`)
            const exported = JSON.parse(readFileSync(backup, 'utf8'))
            assert(exported.images.length === 2, 'Backup did not deduplicate images')
            await js(`window.journal.invoke({type:'import'})`)
            const restored = await js(`window.journal.invoke({type:'state'}).then(r=>r.state)`)
            assert(
                restored.restoreId &&
                    JSON.stringify(restored.drafts[0].body) === JSON.stringify(persisted.drafts[0].body),
                'Restore changed writing'
            )
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait(`!!document.querySelector('[aria-label="Open journal"]')`)
            await js(`document.querySelector('[aria-label="Open journal"]').click()`)
            await wait(`document.querySelectorAll('.journal-image-preview img').length===4`)
            await js(`document.querySelectorAll('.journal-image-preview img').forEach(i=>i.loading='eager')`)
            await wait(
                `Array.from(document.querySelectorAll('.journal-image-preview img')).every(i=>i.naturalWidth===1200 || i.naturalWidth===100)`
            )
            await pause(150)
            console.info('Checking viewer sizing, zoom, and download')
            // Check the complete viewer with multiple images, keyboard zoom and native download.
            await js(`document.querySelector('.journal-image-preview').click()`)
            await wait(`!!document.querySelector('.journal-lightbox')`)
            await wait(`document.querySelector('.journal-lightbox-stage img')?.naturalWidth>0`)
            await js(`document.querySelector('[aria-label="Zoom in"]').click()`)
            await wait(`document.querySelector('.journal-lightbox-stage').dataset.zoomed==='true'`)
            await js(`document.querySelector('[aria-label="Fit image"]').click()`)
            await js(`document.querySelector('.journal-lightbox-stage').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
            await wait(`document.querySelector('.journal-lightbox [role="status"]').textContent==='Image 2 of 4'`)
            const imageId = await js(`document.querySelector('.journal-lightbox-stage img').src.split('/').pop()`)
            await js(`window.journal.images.save(${JSON.stringify(imageId)})`)
            assert(readFileSync(join(directory, 'journal-image.png')).equals(png), 'Downloaded image bytes changed')
            const svgId = await js(
                `Array.from(document.querySelectorAll('.journal-image-preview img')).find(i=>i.naturalWidth===100).src.split('/').pop()`
            )
            await js(`window.journal.images.save(${JSON.stringify(svgId)})`)
            assert(
                readFileSync(join(directory, 'journal-image.svg'), 'utf8') === svg,
                'Downloaded SVG lost its original vector bytes'
            )
            console.info('Native image download passed')
            await js(
                `window.__imageContrast=(foreground,background)=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');const luminance=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};true`
            )
            const measurements = []
            for (const theme of ['light', 'dark']) {
                await js(
                    `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.documentElement.dataset.accent='blue';true`
                )
                for (const width of [320, 390, 768, 1024, 1440]) {
                    await viewport(width)
                    await pause(120)
                    console.info(`Checking ${theme} viewer at ${width}px`)
                    const result = await js(
                        `(()=>{const host=document.querySelector('.journal-lightbox');const children=[...host.querySelectorAll('.journal-lightbox-controls [role="toolbar"]')];const color=getComputedStyle(children[0]);return {width:innerWidth,fit:children.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}),color:color.color,background:color.backgroundColor,contrast:window.__imageContrast(color.color,color.backgroundColor)};})()`
                    )
                    assert(result.width === width, `Viewport did not resize to ${width}px`)
                    assert(result.fit, `Viewer controls clipped at ${width}px in ${theme}`)
                    assert(result.contrast >= 4.5, `Viewer control text contrast failed in ${theme}`)
                    measurements.push({ theme, ...result })
                }
            }
            await cdp('Emulation.clearDeviceMetricsOverride')
            window.webContents.setZoomFactor(2)
            await pause(150)
            assert(
                await js(
                    `Array.from(document.querySelectorAll('.journal-lightbox-controls [role="toolbar"]')).every(e=>e.getBoundingClientRect().right<=innerWidth)`
                ),
                'Viewer controls clipped at 200% zoom'
            )
            window.webContents.setZoomFactor(1)
            writeFileSync(join(directory, 'viewer-measurements.json'), JSON.stringify(measurements, null, 2))
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            await wait(`!document.querySelector('.journal-lightbox')`)
            const invalid = (await window.webContents.session.fetch('journal-image://local/../../etc/passwd')).status
            assert(invalid === 404, 'Image scheme accepted an invalid ID')
            console.info(
                JSON.stringify({
                    passed: true,
                    picker: true,
                    paste: true,
                    drop: true,
                    preview: true,
                    svg: true,
                    smallImageMenu: true,
                    whitespaceDropGuide: true,
                    errorToastCleanup: true,
                    focusReturn: true,
                    imageBackupRestore: true,
                    offlineReload: true,
                    directory
                })
            )
            app.exit(0)
        } catch (error) {
            console.error(error)
            try {
                writeFileSync(join(directory, 'failure.png'), await screenshot())
            } catch {
                /* Preserve the original smoke failure. */
            }
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve(appRoot, 'out/main/index.js')).href)
