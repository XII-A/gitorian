import { Extension, Node, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { writingDirection } from './journal-direction'

// Structural definitions are shared with the renderer; node views and interaction
// plugins extend these definitions without changing the persisted schema.
export const ToggleNode = Node.create({
    name: 'toggle',
    group: 'block',
    content: 'toggleSummary toggleContent',
    defining: true
})
export const ToggleSummaryNode = Node.create({ name: 'toggleSummary', content: 'inline*', defining: true })
export const ToggleContentNode = Node.create({ name: 'toggleContent', content: 'block+', defining: true })
export const ImageNode = Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes: () => ({ assetId: { default: '' }, alt: { default: '' } })
})
export const DirectionSchema = Extension.create({
    name: 'writingDirectionSchema',
    addGlobalAttributes: () => [
        {
            types: ['doc', 'paragraph', 'heading', 'toggleSummary', 'image'],
            attributes: {
                direction: {
                    default: null,
                    validate: (value: unknown) => {
                        if (value !== null && !writingDirection(value)) throw new Error('Invalid writing direction')
                    }
                }
            }
        }
    ]
})
export const writingStarter = { heading: { levels: [1, 2, 3, 4] as (1 | 2 | 3 | 4)[] }, link: { openOnClick: false } }
export const bodySchema = getSchema([
    StarterKit.configure(writingStarter),
    TaskList,
    TaskItem.configure({ nested: true }),
    ToggleNode,
    ToggleSummaryNode,
    ToggleContentNode,
    ImageNode,
    DirectionSchema
])
export const titleSchema = getSchema([
    Node.create({ name: 'doc', content: 'text*' }),
    Node.create({ name: 'text', group: 'inline' })
])
export const titleDocument = (text: string) => ({ type: 'doc', ...(text ? { content: [{ type: 'text', text }] } : {}) })
