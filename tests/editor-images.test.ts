// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor as JournalEditor } from '../src/renderer/Editor'
import { Editor } from '@tiptap/react'
import { journalExtensions } from '../src/renderer/journal-extensions'
import { ImageImports, imageImportKey } from '../src/renderer/journal-images'
import type { JournalNode } from '../src/shared/model'
import { imageIds } from '../src/shared/images'
import { ToastStackProvider } from '../src/renderer/components/arc/toast-stack/toast-stack'

const editors: Editor[] = []
afterEach(() =>
    editors.splice(0).forEach((editor) => {
        if (!editor.isDestroyed) editor.destroy()
    })
)
const file = () => new File([new Uint8Array([1, 2, 3])], 'design.png', { type: 'image/png' })
const pause = () => new Promise((resolve) => setTimeout(resolve, 0))
function setup(write: (bytes: Uint8Array) => Promise<string>) {
    const editor = new Editor({
        element: document.createElement('div'),
        extensions: journalExtensions(),
        content: '<p>Before after</p>'
    })
    editors.push(editor)
    const changes: number[] = []
    const failed = vi.fn()
    const manager = new ImageImports(editor, write, (jobs) => changes.push(jobs.length), failed)
    editor.on('transaction', () => manager.sync())
    return { editor, manager, changes, failed }
}

it('maps a pending insertion while typing and keeps bytes out of serialized writing', async () => {
    let resolve!: (id: string) => void
    const app = setup(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    app.manager.add([file()], 8)
    await pause()
    expect(app.editor.getJSON()).not.toHaveProperty('bytes')
    app.editor.commands.insertContentAt(1, 'New ')
    resolve('a'.repeat(64))
    await pause()
    expect(app.editor.getText()).toContain('New Before')
    expect(imageIds(app.editor.getJSON())).toEqual(['a'.repeat(64)])
    const body = app.editor.getJSON() as JournalNode
    const image = body.content!.findIndex((node) => node.type === 'image')
    expect(body.content![image - 1].content![0].text).toBe('New Before ')
    expect(app.changes.at(-1)).toBe(0)
    app.editor.commands.undo()
    expect(imageIds(app.editor.getJSON())).toEqual([])
    app.editor.commands.redo()
    expect(imageIds(app.editor.getJSON())).toEqual(['a'.repeat(64)])
})

it('cancels pending image insertion with undo and never resurrects it after completion', async () => {
    let resolve!: (id: string) => void
    const app = setup(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    app.manager.add([file()], 3)
    await pause()
    app.editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(imageImportKey.getState(app.editor.state)?.find()).toHaveLength(0)
    resolve('b'.repeat(64))
    await pause()
    expect(imageIds(app.editor.getJSON())).toEqual([])
    expect(app.changes.at(-1)).toBe(0)
})

it('removes a failed import and continues the batch without adding error content', async () => {
    let attempt = 0
    const app = setup(() => {
        if (++attempt === 1) throw new Error('Disk unavailable. Try importing again.')
        return Promise.resolve('c'.repeat(64))
    })
    app.manager.add([file(), file()], 1)
    await pause()
    expect(imageIds(app.editor.getJSON())).toEqual(['c'.repeat(64)])
    expect(imageImportKey.getState(app.editor.state)?.find()).toHaveLength(0)
    expect(app.editor.getText()).not.toContain('unavailable')
    expect(app.failed).toHaveBeenCalledExactlyOnceWith('Disk unavailable. Try importing again.')
    expect(app.changes.at(-1)).toBe(0)
})

it('drops completions after editor session disposal and ignores arbitrary external HTML images', async () => {
    let resolve!: (id: string) => void
    const app = setup(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    app.manager.add([file()], 1)
    await pause()
    app.manager.dispose()
    app.editor.destroy()
    resolve('a'.repeat(64))
    await pause()
    const next = setup(() => Promise.resolve('b'.repeat(64)))
    next.editor.commands.insertContent(
        '<img src="https://example.com/design.png"><img src="data:image/png;base64,abcd">'
    )
    expect(imageIds(next.editor.getJSON())).toEqual([])
    next.editor.commands.insertContent(
        `<img data-journal-image="${'b'.repeat(64)}" src="javascript:alert(1)" alt="Diagram">`
    )
    expect(next.editor.getHTML()).toContain(`journal-image://local/${'b'.repeat(64)}`)
    expect(next.editor.getHTML()).not.toContain('javascript:')
})

it('releases the template save gate when its editor unmounts during an import', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const ready = vi.fn()
    let finish!: (id: string) => void
    vi.stubGlobal('journal', {
        images: {
            import: () =>
                new Promise<string>((resolve) => {
                    finish = resolve
                })
        }
    })
    try {
        await act(async () => {
            root.render(
                createElement(
                    ToastStackProvider,
                    null,
                    createElement(JournalEditor, {
                        value: { type: 'doc', content: [{ type: 'paragraph' }] },
                        onImagesReadyChange: ready
                    })
                )
            )
            await Promise.resolve()
        })
        await act(async () => {
            const input = host.querySelector('input[type=file]')!
            Object.defineProperty(input, 'files', { value: [file()] })
            input.dispatchEvent(new Event('change', { bubbles: true }))
            await pause()
        })
        expect(ready).toHaveBeenLastCalledWith(false)
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        expect(ready).toHaveBeenLastCalledWith(true)
        finish('a'.repeat(64))
        await pause()
        expect(host.querySelector('.journal-image')).toBeNull()
    } finally {
        host.remove()
        vi.unstubAllGlobals()
    }
})

it('guides and accepts a file in the writing-space gap even when Tiptap has no position at those coordinates', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    host.dataset.journalDropZone = ''
    document.body.append(host)
    const root = createRoot(host)
    const write = vi.fn(() => Promise.resolve('a'.repeat(64)))
    vi.stubGlobal('journal', { images: { import: write } })
    try {
        await act(async () => {
            root.render(
                createElement(
                    ToastStackProvider,
                    null,
                    createElement(JournalEditor, {
                        value: {
                            type: 'doc',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A sentence' }] }]
                        }
                    })
                )
            )
            await Promise.resolve()
        })
        const element = host.querySelector('.tiptap') as HTMLElement & { editor: Editor }
        vi.spyOn(element.editor.view, 'posAtCoords').mockReturnValue(null)
        const gap = document.createElement('div')
        host.append(gap)
        const dispatch = (type: string) => {
            const event = new Event(type, { bubbles: true, cancelable: true })
            Object.defineProperties(event, {
                clientX: { value: 20 },
                clientY: { value: 200 },
                dataTransfer: { value: { files: [file()], types: ['Files'], dropEffect: 'none' } }
            })
            gap.dispatchEvent(event)
            return event.defaultPrevented
        }
        await act(async () => {
            expect(dispatch('dragover')).toBe(true)
            await Promise.resolve()
        })
        expect(host.querySelector('.journal-image-drop-guide')).not.toBeNull()
        await act(async () => {
            expect(dispatch('drop')).toBe(true)
            await pause()
        })
        expect(write).toHaveBeenCalledTimes(1)
        expect(imageIds(element.editor.getJSON())).toEqual(['a'.repeat(64)])
        expect(host.querySelector('.journal-image-drop-guide')).toBeNull()
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
        vi.unstubAllGlobals()
    }
})
