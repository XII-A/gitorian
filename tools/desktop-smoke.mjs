import { app, BrowserWindow, dialog } from 'electron'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'weekly-j-desktop-'))
app.setPath('userData', directory)
const repositoryFolder = join(directory, 'repositories')
for (const name of ['first-project', 'second-project']) {
    const path = join(repositoryFolder, name)
    mkdirSync(path, { recursive: true })
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Smoke author'],
        ['config', 'user.email', 'smoke@example.com'],
        ['commit', '--allow-empty', '-m', 'Initial work'],
        ['branch', 'feature']
    ])
        execFileSync('git', args, { cwd: path, windowsHide: true, stdio: 'ignore' })
}
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
const waitForElement = async (window, selector) => {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (await window.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`)) return
        await pause(100)
    }
    throw new Error(`Element did not become ready: ${selector}`)
}
let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message)
    })
    window.webContents.once('did-finish-load', async () => {
        if (checking || window.webContents.getURL().includes('reference=')) return
        checking = true
        let passed = false
        try {
            await pause(600)
            const originalFolderPicker = dialog.showOpenDialog
            dialog.showOpenDialog = () =>
                new Promise((resolve) =>
                    setTimeout(() => resolve({ canceled: false, filePaths: [repositoryFolder] }), 650)
                )
            const settingsResult = await window.webContents.executeJavaScript(`(async () => {
                document.querySelector('[aria-label="Open settings"]').click()
                await new Promise(resolve => setTimeout(resolve, 150))
                const importProgress=[]
                const unsubscribeImport=window.journal.onRepositoryImportProgress(update=>importProgress.push(update))
                const settingsScrollArea = !!document.querySelector('.settings-scroll [role="region"][aria-label="Settings content"]')
                Array.from(document.querySelectorAll('.settings button')).find(button => button.textContent.includes('Add repositories from folder')).click()
                await new Promise(resolve=>setTimeout(resolve,300))
                const importWaitsForSelection=document.querySelector('.settings').textContent.includes('Waiting for folder selection')
                const importButton=Array.from(document.querySelectorAll('.settings button')).find(button=>button.textContent.includes('Waiting for folder selection'))
                const importPhase=Array.from(importButton.querySelectorAll('span')).find(span=>span.textContent.includes('Waiting for folder selection')&&span.children.length===0)
                let importLabelVisible=!!importPhase
                // Assert the loading style too: Chromium may pause CSS transitions in this hidden window.
                if (importButton.querySelector('[class*="loadingLabel"]')) importLabelVisible=false
                for (let parent=importPhase?.parentElement;parent&&parent!==importButton;parent=parent.parentElement)
                    if (Number(getComputedStyle(parent).opacity)<0.9) importLabelVisible=false
                if (!importLabelVisible) throw new Error('Repository import label is hidden behind the loading spinner')
                for (let attempt=0;attempt<30;attempt++) {
                    await new Promise(resolve => setTimeout(resolve,100))
                    if ((await window.journal.invoke({type:'state'})).state.repositories.length===2) break
                }
                const after=(await window.journal.invoke({type:'state'})).state
                const folderAddsRepositories = after.repositories.length===2 && after.repositories.every(repo=>repo.branches.includes('feature'))
                for (let attempt=0;attempt<20;attempt++) {
                    if (document.querySelectorAll('.settings-repositories article').length===2) break
                    await new Promise(resolve=>setTimeout(resolve,100))
                }
                const verticalSettingsTabs = document.querySelector('.settings [role="tablist"]').getAttribute('aria-orientation')==='vertical'
                const allRepositoryCardsClosed = Array.from(document.querySelectorAll('.settings-repositories article')).every(card=>card.dataset.expanded!=='true')
                const folderImportProgress = importProgress.some(update=>update.stage==='selecting') && importProgress.some(update=>update.stage==='discovering') && importProgress.some(update=>update.stage==='processing'&&update.completed===2&&update.total===2)
                unsubscribeImport()
                const repositoryCards = Array.from(document.querySelectorAll('.settings-repositories article'))
                const repositoryCardPaths = repositoryCards.length===2 && repositoryCards.every((card,index)=>card.querySelector('button').textContent.includes(after.repositories[index].path))
                repositoryCards[0].querySelector('button').click()
                repositoryCards[1].querySelector('button').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                const repositoriesExpandIndependently = repositoryCards.every(card=>card.dataset.expanded==='true')
                const repositoryTrackingSwitch = !!document.querySelector('.settings [role="switch"][aria-label="Track this repository"]') && !document.querySelector('.settings textarea')
                const selectTab = label => Array.from(document.querySelectorAll('.settings [role="tab"]')).find(tab=>tab.textContent===label).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))
                selectTab('Connections')
                await new Promise(resolve=>setTimeout(resolve,100))
                const noDisconnectedAction = !Array.from(document.querySelectorAll('.settings button')).some(button=>button.textContent.includes('Disconnect'))
                selectTab('Preferences')
                await new Promise(resolve=>setTimeout(resolve,100))
                const timezoneSelect = !!document.querySelector('.settings input[role="combobox"]')
                const refreshField = document.querySelector('.settings [role="spinbutton"]')
                const previousRefresh = Number(refreshField.getAttribute('aria-valuenow'))
                document.querySelector('[aria-label="Increase Refresh interval"]').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                const refreshNumberField = Number(refreshField.getAttribute('aria-valuenow'))===previousRefresh+1 && refreshField.getAttribute('aria-valuemin')==='0' && refreshField.getAttribute('aria-valuemax')==='1440'
                document.querySelector('.settings [aria-label="Close dialog"]').click()
                await new Promise(resolve=>setTimeout(resolve,150))
                const confirmation=document.querySelector('[role="alertdialog"]')
                const unsavedCloseGuard=!!confirmation && document.activeElement.textContent==='Keep editing'
                Array.from(confirmation.querySelectorAll('button')).find(button=>button.textContent==='Keep editing').click()
                  // Hidden smoke windows can retain an invisible exit node until the next paint.
                  for (let attempt=0;attempt<20 && document.querySelector('[role="alertdialog"][data-state="open"]');attempt++)
                    await new Promise(resolve=>setTimeout(resolve,50))
                  const keepEditingPreservesChanges=!!document.querySelector('.settings') && !document.querySelector('[role="alertdialog"][data-state="open"]') && Number(refreshField.getAttribute('aria-valuenow'))===previousRefresh+1
                  if (!keepEditingPreservesChanges) throw new Error(JSON.stringify({settings:!!document.querySelector('.settings'),confirmation:!!document.querySelector('[role="alertdialog"]'),confirmationState:document.querySelector('[role="alertdialog"]')?.getAttribute('data-state'),opacity:document.querySelector('[role="alertdialog"]')&&getComputedStyle(document.querySelector('[role="alertdialog"]')).opacity,refresh:refreshField.getAttribute('aria-valuenow'),expected:previousRefresh+1}))
                document.querySelector('.settings [aria-label="Close dialog"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))
                await new Promise(resolve=>setTimeout(resolve,150))
                const unsavedEscapeGuard=!!document.querySelector('[role="alertdialog"]')
                Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(button=>button.textContent==='Discard changes').click()
                await new Promise(resolve=>setTimeout(resolve,200))
                const discardDoesNotSave=!document.querySelector('.settings') && (await window.journal.invoke({type:'state'})).state.settings.refreshMinutes===previousRefresh
                document.querySelector('[aria-label="Open settings"]').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                document.querySelector('.settings [aria-label="Close dialog"]').click()
                await new Promise(resolve=>setTimeout(resolve,200))
                const cleanSettingsClose=!document.querySelector('.settings') && !document.querySelector('[role="alertdialog"]')
                document.querySelector('[aria-label="Open settings"]').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                selectTab('Preferences')
                await new Promise(resolve=>setTimeout(resolve,100))
                const settingsViewport = document.querySelector('.settings-scroll [role="region"]')
                const beforeMenu = {height:settingsViewport.clientHeight,scroll:settingsViewport.scrollHeight,top:settingsViewport.scrollTop}
                document.querySelector('.settings input[role="combobox"]').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                const timezoneMenu = document.querySelector('[role="region"][aria-label="Timezone options"] [role="listbox"]')
                const timezoneUsesOwnScrollArea = !!timezoneMenu?.closest('[role="region"][aria-label="Timezone options"]') && !document.querySelector('.settings').contains(timezoneMenu)
                const timezoneMotionOwnsAnimation = getComputedStyle(timezoneMenu.closest('[data-side]')).transitionDuration==='0s' && getComputedStyle(timezoneMenu.closest('[data-side]')).animationName==='none'
                Array.from(timezoneMenu.querySelectorAll('[role="option"]')).find(option=>option.textContent==='UTC').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                const timezoneKeepsPaneSize = settingsViewport.clientHeight===beforeMenu.height && settingsViewport.scrollHeight===beforeMenu.scroll && settingsViewport.scrollTop===beforeMenu.top && document.querySelector('.settings input[role="combobox"]').getAttribute('aria-expanded')==='false'
                selectTab('Template')
                await new Promise(resolve=>setTimeout(resolve,100))
                const template=document.querySelector('.settings [role="textbox"][aria-label="Entry template"]')
                const arcTemplateEditor = !!template && !document.querySelector('.settings .editor-toolbar') && !!template.closest('.settings-template') && !!document.querySelector('[aria-label="Undo template edit"]')
                const templateTitleHasNoFormattingHint=!document.querySelector('.settings-section-heading kbd')
                if (!template) throw new Error('The Arc template editor did not open')
                template.focus()
                document.execCommand('insertHTML',false,'<h2>What changed</h2><p>Template reflection.</p>')
                template.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))
                await new Promise(resolve=>setTimeout(resolve,50))
                Array.from(document.querySelectorAll('.settings-footer button')).find(button=>button.textContent==='Save settings').click()
                for (let attempt=0;attempt<20;attempt++) {
                    await new Promise(resolve=>setTimeout(resolve,100))
                    if (!document.querySelector('.settings')) break
                }
                const saved=(await window.journal.invoke({type:'state'})).state
                const templateSaved = JSON.stringify(saved.settings.template).includes('Template reflection.') && saved.settings.template.content.some(node=>node.type==='heading'&&node.attrs.level===2)
                return {settingsScrollArea,folderAddsRepositories,verticalSettingsTabs,repositoryTrackingSwitch,repositoryCardPaths,repositoriesExpandIndependently,allRepositoryCardsClosed,folderImportProgress,importWaitsForSelection,importLabelVisible,noDisconnectedAction,refreshNumberField,timezoneSelect,timezoneUsesOwnScrollArea,timezoneMotionOwnsAnimation,timezoneKeepsPaneSize,arcTemplateEditor,templateSaved,templateTitleHasNoFormattingHint,unsavedCloseGuard,keepEditingPreservesChanges,unsavedEscapeGuard,discardDoesNotSave,cleanSettingsClose}
            })()`)
            dialog.showOpenDialog = originalFolderPicker
            const result = await window.webContents.executeJavaScript(`(async () => {
                const before = await window.journal.invoke({type:'state'})
                const opensOnHub = !!document.querySelector('.hub-topbar')
                const hubProjectChip=document.querySelector('.hub-filters > :last-child [role="combobox"]')?.textContent.includes('Projects')
                const hubUsesArcChart=!!document.querySelector('.hub-chart [role="slider"]')
                document.querySelector('[aria-label="Refresh activity"]').click()
                for(let attempt=0;attempt<30&&!document.querySelector('.hub-activity');attempt++)
                    await new Promise(resolve=>setTimeout(resolve,50))
                let dialogDateFormats=0
                const originalFormatter=Intl.DateTimeFormat
                Intl.DateTimeFormat=new Proxy(originalFormatter,{construct(target,args){dialogDateFormats++;return Reflect.construct(target,args)}})
                document.querySelector('.hub-activity').click()
                await new Promise(resolve=>setTimeout(resolve,300))
                Intl.DateTimeFormat=originalFormatter
                const hubDialogKeepsListIdle=dialogDateFormats<20
                const hubDialogArcScroll=!!document.querySelector('.hub-detail-dialog [role="region"][aria-label="Activity details"]')
                const hubDialogDimBackdrop=getComputedStyle(document.querySelector('[data-backdrop="dim"]')).backdropFilter==='none'
                document.querySelector('.hub-detail-dialog [aria-label="Close dialog"]').click()
                await new Promise(resolve=>setTimeout(resolve,250))
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 150))
                const workspaceImplemented = !!document.querySelector('.ws-frame') && document.querySelector('.writing-workspace').dataset.layout === 'three-panes' && !document.querySelector('.variant-picker')
                const noDraftCreated = (await window.journal.invoke({type:'state'})).state.drafts.length === before.state.drafts.length
                document.querySelector('[aria-label="Journal breadcrumb"] button[data-label="Journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 100))
                const returnsToHub = !!document.querySelector('.hub-topbar')
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 100))
                Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Start this week')).click()
                await new Promise(resolve => setTimeout(resolve, 200))
                document.querySelector('[aria-label="Journal body"]').focus()
                const newEntryUsesTemplate=document.querySelector('[aria-label="Journal body"]').textContent.includes('Template reflection.') && !!document.querySelector('[aria-label="Journal body"] h2')
                return {opensOnHub,hubProjectChip,hubUsesArcChart,hubDialogKeepsListIdle,hubDialogArcScroll,hubDialogDimBackdrop,workspaceImplemented,noDraftCreated,returnsToHub,newEntryUsesTemplate,node:typeof require,version:before.state.version}
            })().catch(error => ({failure:String(error),stack:error.stack,text:document.body.innerText}))`)
            if ('failure' in result) throw new Error(JSON.stringify(result))
            Object.assign(result, settingsResult)
            await window.webContents.insertText('The draft survives a restart.')
            await pause(700)
            result.draftSaved = await window.webContents.executeJavaScript(
                `(async () => JSON.stringify((await window.journal.invoke({type:'state'})).state.drafts[0].body).includes('The draft survives a restart.'))()`
            )
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(base + '?workspace=true')
            await waitForElement(window, '[aria-label="Journal body"]')
            result.draftRecovered = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('The draft survives a restart.')`
            )
            result.disconnectedWritingReady = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').getAttribute('contenteditable') === 'true' && !document.querySelector('.ws-paper').textContent.includes('Your writing stays here.') && document.querySelector('.ws-writing-footer').textContent.includes('Connect Notion in settings') && document.querySelector('.ws-publish button').disabled`
            )
            // A newer recovery copy must win over an older backend draft, then persist.
            await window.webContents.executeJavaScript(`(async () => {
                const state = (await window.journal.invoke({type:'state'})).state
                const draft = {...state.drafts[0],updatedAt:new Date(Date.now()+1000).toISOString(),body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Recovered an interrupted save.'}]}]}}
                localStorage.setItem('weekly-j:recovery:'+(state.restoreId??'local')+':'+draft.week,JSON.stringify(draft))
            })()`)
            await window.loadURL(base + '?workspace=true')
            await waitForElement(window, '[aria-label="Journal body"]')
            await pause(250)
            result.interruptedSaveRecovered = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('Recovered an interrupted save.')`
            )
            await window.loadURL(base + '?workspace=true&data=sample&week=2026-10-05')
            await waitForElement(window, '[aria-label="Journal body"]')
            const realDraftsBefore = await window.webContents.executeJavaScript(
                `(async () => (await window.journal.invoke({type:'state'})).state.drafts.length)()`
            )
            result.summaryDismissesOutsideChart = await window.webContents.executeJavaScript(`(async () => {
                const slider = document.querySelector('.ws-week-chart [role="slider"]')
                const rect = slider.getBoundingClientRect()
                slider.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,pointerType:'mouse',clientX:rect.left+rect.width*2.5/7,clientY:rect.top+18}))
                await new Promise(resolve => setTimeout(resolve, 80))
                const card = document.querySelector('.activity-day-popover[data-state="open"]')
                if (!card) throw new Error('Chart summary did not open')
                slider.dispatchEvent(new PointerEvent('pointerout', {bubbles:true,pointerType:'mouse',relatedTarget:null}))
                await new Promise(resolve => setTimeout(resolve, 40))
                // Enter from outside the chart, as when crossing the gap to the card.
                card.dispatchEvent(new PointerEvent('pointerover', {bubbles:true,pointerType:'mouse',relatedTarget:null}))
                await new Promise(resolve => setTimeout(resolve, 400))
                return !document.querySelector('.activity-day-popover[data-state="open"]')
            })()`)
            await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Pop out diff"]').click()`)
            await pause(600)
            const reference = BrowserWindow.getAllWindows().find((candidate) =>
                candidate.webContents.getURL().includes('reference=activity')
            )
            if (!reference) throw new Error('The native diff window did not open')
            await waitForElement(reference, '.ws-inspector-footer button')
            result.nativeDiffWindow = await reference.webContents.executeJavaScript(
                `!!document.querySelector('.ws-reference') && document.querySelector('.diff').textContent.includes('BASE_DELAY_MS')`
            )
            result.referenceIsReadOnly = await reference.webContents.executeJavaScript(
                `(async () => { try { await window.journal.invoke({type:'newDraft',week:'2026-10-05'}); return false } catch(error) { return String(error).includes('read-only') } })()`
            )
            await reference.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Cite in entry')).click()`
            )
            await pause(400)
            result.secondWindowCitation = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('Retry failed sync batches with backoff')`
            )
            result.citationWithoutHeaderNotice = await window.webContents.executeJavaScript(
                `!document.querySelector('.ws-action-notice')`
            )
            result.noReferenceNotes = await reference.webContents.executeJavaScript(
                `!document.querySelector('.ws-reference-note') && !Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Add note')) && document.querySelector('[role="status"]').textContent.includes('Added to your entry.')`
            )
            result.sampleIsolated = await window.webContents.executeJavaScript(
                `(async () => (await window.journal.invoke({type:'state'})).state.drafts.length === ${realDraftsBefore})()`
            )
            await reference.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Dock back to workspace"]').click()`
            )
            await pause(250)
            result.dockedBack =
                reference.isDestroyed() &&
                (await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Pop out diff"]')`))
            Object.assign(
                result,
                await window.webContents.executeJavaScript(`(() => {
                const frame = document.querySelector('.ws-frame').getBoundingClientRect()
                const buttons = Array.from(document.querySelectorAll('.ws-topbar button'))
                return {
                    fillsViewport: frame.left === 0 && Math.abs(frame.right - innerWidth) < 1 && Math.abs(frame.bottom - innerHeight) < 1,
                    cleanWritingSurface: !document.querySelector('.ws-writing-bar') && !document.querySelector('.ws-review-footer'),
                    publishIsLastHeaderAction: buttons.at(-1) === document.querySelector('.ws-publish button'),
                    matchingPaneFooters: document.querySelector('.ws-writing-footer').getBoundingClientRect().height === document.querySelector('.ws-inspector-footer').getBoundingClientRect().height,
                    // The hidden smoke window pauses Motion; inspect the date mount while the visible preview verifies the trigger.
                    centeredDatePicker: Math.abs((document.querySelector('.ws-date').getBoundingClientRect().left + document.querySelector('.ws-date').getBoundingClientRect().right) / 2 - innerWidth / 2) < 1,
                    compactHeader: document.querySelector('.ws-topbar').getBoundingClientRect().height <= 60,
                    keyboardScrollablePanes: ['.ws-activity-scroll','.ws-paper-scroll','.ws-diff-scroll'].every(selector => document.querySelector(selector+' [role="region"]')?.tabIndex === 0)
                }
            })()`)
            )
            await window.webContents.executeJavaScript(`document.querySelector('.ws-publish button').click()`)
            await pause(200)
            result.headerPublishesSample = await window.webContents.executeJavaScript(
                `document.querySelector('.ws-publish button').textContent.includes('Start another entry') && document.querySelector('.ws-writing-footer').textContent.includes('Nothing was sent to Notion')`
            )
            await window.webContents.executeJavaScript(`document.querySelector('.ws-publish button').click()`)
            await pause(200)
            result.newEntryAfterPublishing = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Entry title"]').value === '' && document.querySelector('[aria-label="Journal body"]').getAttribute('contenteditable') === 'true'`
            )
            passed = Object.entries(result).every(([key, value]) =>
                key === 'node' ? value === 'undefined' : key === 'version' ? value === 1 : value === true
            )
            console.info(JSON.stringify({ ...result, electron: process.versions.electron, passed }))
        } catch (error) {
            console.error(error)
        }
        app.exit(passed ? 0 : 1)
    })
})
app.on('will-quit', () => {
    // Check the absolute temporary target before removing smoke-test data on Windows.
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + '\\') || !target.includes('weekly-j-desktop-')) return
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        /* Chromium may retain its user-data lock until exit. */
    }
})
setTimeout(() => {
    console.error('Desktop workspace smoke test timed out')
    app.exit(1)
}, 30000).unref()
import(pathToFileURL(resolve('out/main/index.js')).href).catch(
    /** @param {unknown} error */ (error) => {
        console.error(error)
        app.exit(1)
    }
)
