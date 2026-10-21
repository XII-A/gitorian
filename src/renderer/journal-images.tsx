import { Node, Extension, mergeAttributes } from '@tiptap/react'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isHistoryTransaction, closeHistory } from '@tiptap/pm/history'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button } from './components/arc/button/button'
import { X } from 'lucide-react'
import { Skeleton } from './components/arc/skeleton/skeleton'
import { JournalImageView } from './JournalImageView'
import { imageURL, imageIdPattern, imageLimits } from '../shared/images'

export const JournalImageNode = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
        return {
            assetId: { default: '', parseHTML: (element) => element.getAttribute('data-journal-image') },
            alt: { default: '' }
        }
    },
    parseHTML() {
        return [
            {
                tag: 'img[data-journal-image]',
                getAttrs: (element) =>
                    imageIdPattern.test(element.getAttribute('data-journal-image') ?? '') ? {} : false
            }
        ]
    },
    renderHTML({ node, HTMLAttributes }) {
        return [
            'img',
            mergeAttributes(HTMLAttributes, {
                'data-journal-image': node.attrs.assetId,
                src: imageURL(String(node.attrs.assetId)),
                alt: node.attrs.alt
            })
        ]
    },
    addNodeView() {
        return ReactNodeViewRenderer(JournalImageView)
    }
})

const skeletonRoots = new WeakMap<globalThis.Node, Root>()

export const imageImportKey = new PluginKey<DecorationSet>('journalImageImports')
export const ImageImportPositions = Extension.create({
    name: 'imageImportPositions',
    priority: 1200,
    addKeyboardShortcuts() {
        return {
            'Mod-z': () => {
                if (!imageImportKey.getState(this.editor.state)?.find().length) return false
                this.editor.view.dispatch(this.editor.state.tr.setMeta(imageImportKey, { cancel: true }))
                return true
            }
        }
    },
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: imageImportKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(transaction, decorations) {
                        if (isHistoryTransaction(transaction) || transaction.getMeta(imageImportKey)?.cancel)
                            return DecorationSet.empty
                        let next = decorations.map(transaction.mapping, transaction.doc)
                        const change = transaction.getMeta(imageImportKey) as
                            | { add?: { id: string; pos: number }[]; remove?: string }
                            | undefined
                        if (change?.remove)
                            next = next.remove(next.find(undefined, undefined, (spec) => spec.id === change.remove))
                        if (change?.add)
                            next = next.add(
                                transaction.doc,
                                change.add.map(({ id, pos }) =>
                                    Decoration.widget(
                                        pos,
                                        (view) => {
                                            const status = document.createElement('div')
                                            status.className = 'journal-image-pending'
                                            status.contentEditable = 'false'
                                            const root = createRoot(status)
                                            skeletonRoots.set(status, root)
                                            root.render(
                                                createElement(
                                                    'div',
                                                    null,
                                                    createElement(Skeleton, {
                                                        className: 'journal-image-skeleton',
                                                        shape: 'block',
                                                        label: 'Importing image'
                                                    }),
                                                    createElement(
                                                        Button,
                                                        {
                                                            className: 'journal-image-cancel',
                                                            variant: 'ghost',
                                                            size: 'sm',
                                                            'aria-label': 'Cancel image import',
                                                            onClick: () =>
                                                                view.dispatch(
                                                                    view.state.tr.setMeta(imageImportKey, {
                                                                        remove: id
                                                                    })
                                                                )
                                                        },
                                                        createElement(X, { size: 16, 'aria-hidden': true })
                                                    )
                                                )
                                            )
                                            return status
                                        },
                                        {
                                            id,
                                            key: id,
                                            side: 1,
                                            destroy(element) {
                                                const root = skeletonRoots.get(element)
                                                queueMicrotask(() => root?.unmount())
                                            }
                                        }
                                    )
                                )
                            )
                        return next
                    }
                },
                props: { decorations: (state) => imageImportKey.getState(state) }
            })
        ]
    }
})

export interface ImageImportJob {
    id: string
    source: { file: File } | { choose: () => Promise<string[]> }
}
/** All entry points share mapped positions; bytes never enter the document or recovery cache. */
export class ImageImports {
    private sequence = 0
    private jobs: ImageImportJob[] = []
    private disposed = false
    private running = false
    constructor(
        private readonly editor: Editor,
        private readonly write: (bytes: Uint8Array) => Promise<string>,
        private readonly changed: (jobs: ImageImportJob[]) => void,
        private readonly failed?: (message: string) => void
    ) {}
    private position(id: string): number | undefined {
        return imageImportKey.getState(this.editor.state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from
    }
    private notify() {
        this.changed([...this.jobs])
    }
    add(files: File[], position = this.editor.state.selection.from) {
        if (files.length > imageLimits.batch) {
            this.failed?.('Choose up to 10 images at a time, then try dropping them again.')
            return
        }
        this.enqueue(
            files.map((file) => ({ file })),
            position
        )
    }
    choose(picker: () => Promise<string[]>) {
        this.enqueue([{ choose: picker }], this.editor.state.selection.from)
    }
    private enqueue(sources: ImageImportJob['source'][], position: number) {
        if (!this.editor.isEditable || this.disposed) return
        const jobs = sources.map((source) => ({ id: `image-${++this.sequence}`, source }))
        this.jobs.push(...jobs)
        this.editor.view.dispatch(
            this.editor.state.tr.setMeta(imageImportKey, { add: jobs.map(({ id }) => ({ id, pos: position })) })
        )
        this.notify()
        void this.drain()
    }
    private async drain() {
        if (this.running || this.disposed) return
        this.running = true
        try {
            while (this.jobs.length && !this.disposed) await this.run(this.jobs[0])
        } finally {
            this.running = false
        }
    }
    private async run(job: ImageImportJob) {
        if (this.disposed || this.editor.isDestroyed || this.position(job.id) === undefined) {
            this.remove(job.id)
            return
        }
        try {
            let assetIds: string[]
            if ('choose' in job.source) assetIds = await job.source.choose()
            else {
                const file = job.source.file
                if (!file.size || file.size > imageLimits.bytes) throw new Error('Choose an image smaller than 5 MB.')
                const bytes = new Uint8Array(await file.arrayBuffer())
                if (
                    this.disposed ||
                    this.editor.isDestroyed ||
                    !this.editor.isEditable ||
                    this.position(job.id) === undefined
                ) {
                    this.remove(job.id)
                    return
                }
                assetIds = [await this.write(bytes)]
            }
            if (this.disposed || this.editor.isDestroyed || !this.editor.isEditable) {
                this.remove(job.id)
                return
            }
            const position = this.position(job.id)
            if (position !== undefined && assetIds.length) {
                this.editor.view.dispatch(closeHistory(this.editor.state.tr))
                this.editor
                    .chain()
                    .insertContentAt(
                        position,
                        assetIds.map((assetId) => ({ type: 'image', attrs: { assetId, alt: '' } })),
                        { updateSelection: false }
                    )
                    .run()
            }
            this.remove(job.id)
        } catch (error) {
            if (this.disposed || this.editor.isDestroyed) return
            if (this.position(job.id) === undefined) {
                this.remove(job.id)
                return
            }
            this.remove(job.id)
            this.failed?.(
                error instanceof Error ? error.message : 'Could not import this image. Try inserting it again.'
            )
        }
    }
    remove(id: string) {
        if (this.disposed) return
        this.jobs = this.jobs.filter((job) => job.id !== id)
        if (!this.editor.isDestroyed)
            this.editor.view.dispatch(this.editor.state.tr.setMeta(imageImportKey, { remove: id }))
        this.notify()
        void this.drain()
    }
    sync() {
        const retained = this.jobs.filter((job) => this.position(job.id) !== undefined)
        if (retained.length !== this.jobs.length) {
            this.jobs = retained
            this.notify()
            void this.drain()
        }
    }
    dispose() {
        this.disposed = true
        this.jobs = []
        this.changed([])
    }
}
