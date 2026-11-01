import { useEffect, useRef } from 'react'
import { EditorView } from '@tiptap/pm/view'
import { EditorState } from '@tiptap/pm/state'
import { history, undo, redo } from '@tiptap/pm/history'
import { keymap } from '@tiptap/pm/keymap'
import { titleSchema } from '../shared/writing-schema'
import type { WritingClient } from './writing-client'

/** Title and body use the same maintained transaction/selection/history engine. */
export function WritingTitle({
    client,
    readOnly,
    onChange
}: {
    client: WritingClient
    readOnly: boolean
    onChange: (text: string) => void
}) {
    const host = useRef<HTMLDivElement>(null)
    const view = useRef<EditorView>(null)
    const changed = useRef(onChange)
    changed.current = onChange
    const locked = useRef(readOnly)
    locked.current = readOnly
    useEffect(() => {
        const editor = new EditorView(host.current, {
            state: EditorState.create({
                schema: titleSchema,
                doc: client.initial,
                plugins: [
                    client.plugin,
                    client.admission,
                    history(),
                    keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo, Enter: () => true })
                ]
            }),
            editable: () => !locked.current,
            attributes: () => ({
                role: 'textbox',
                'aria-readonly': String(locked.current),
                'aria-label': 'Entry title',
                'data-placeholder': 'Entry title',
                dir: 'auto'
            }),
            dispatchTransaction(tr) {
                editor.updateState(editor.state.apply(tr))
                if (tr.docChanged) {
                    changed.current(editor.state.doc.textContent)
                    client.changed()
                }
            }
        })
        view.current = editor
        client.attach({ state: () => editor.state, dispatch: (tr) => editor.dispatch(tr) })
        return () => {
            view.current = null
            editor.destroy()
        }
    }, [client])
    useEffect(() => {
        view.current?.setProps({ editable: () => !readOnly })
    }, [readOnly])
    return <div className="ws-title-input" ref={host} />
}
