import type { Activity, JournalNode, State } from '../shared/model'
import { offsetDay, rangeActivities } from './hub-model'
import type { ActivityRangeState } from './hub-model'

export const dateValue = (value: string) => new Date(`${value}T12:00:00`)
export const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const formatDay = (date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
    dateValue(date).toLocaleDateString('en-US', options)
export function filterWorkspaceActivity(
    state: ActivityRangeState,
    start: string,
    filters: { project: string; branch: string; kind: string; search: string; authors?: string[] }
) {
    return rangeActivities(state, start, offsetDay(start, 6)).filter(
        (activity) =>
            (filters.project === 'all' || activity.repositoryId === filters.project) &&
            (filters.branch === 'all' || activity.branches.includes(filters.branch)) &&
            (!filters.authors?.length ||
                filters.authors.some((author) => activity.author.toLowerCase().includes(author.toLowerCase()))) &&
            (filters.kind === 'all' ||
                (filters.kind === 'commit' ? activity.kind === 'commit' : activity.kind !== 'commit')) &&
            `${activity.title} ${activity.sha ?? ''} ${activity.description}`
                .toLowerCase()
                .includes(filters.search.toLowerCase())
    )
}
export function activityLink(activity: Activity, state: State) {
    if (activity.url) return activity.url
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    const remote = repository?.remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '')
    return activity.sha && remote?.startsWith('https://github.com/') ? `${remote}/commit/${activity.sha}` : undefined
}
const escapeHTML = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function journalHTML(node: JournalNode): string {
    const content = (node.content ?? []).map(journalHTML).join('')
    if (node.type === 'text')
        return (node.marks ?? []).reduce(
            (text, mark) => {
                const tag = (
                    { bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' } as Record<
                        string,
                        string
                    >
                )[mark.type]
                if (tag) return `<${tag}>${text}</${tag}>`
                if (
                    mark.type === 'link' &&
                    typeof mark.attrs?.href === 'string' &&
                    /^(https?:|mailto:|tel:|\/|#)/i.test(mark.attrs.href)
                )
                    return `<a href="${escapeHTML(mark.attrs.href)}">${text}</a>`
                return text
            },
            escapeHTML(node.text ?? '')
        )
    if (node.type === 'doc') return content
    if (node.type === 'hardBreak') return '<br>'
    if (node.type === 'horizontalRule') return '<hr>'
    if (node.type === 'codeBlock') return `<pre>${content}</pre>`
    const tag =
        node.type === 'heading'
            ? `h${Math.min(4, Number(node.attrs?.level ?? 1))}`
            : (
                  {
                      paragraph: 'p',
                      bulletList: 'ul',
                      orderedList: 'ol',
                      listItem: 'li',
                      blockquote: 'blockquote',
                      taskList: 'ul',
                      taskItem: 'li'
                  } as Record<string, string>
              )[node.type]
    if (['toggle', 'toggleSummary', 'toggleContent'].includes(node.type))
        return `<div data-type="${node.type}">${content}</div>`
    return tag ? `<${tag}>${content}</${tag}>` : content
}
export function journalFromHTML(html: string): JournalNode {
    const root = new DOMParser().parseFromString(html, 'text/html').body
    const inline = (parent: Node, marks: NonNullable<JournalNode['marks']> = []): JournalNode[] =>
        Array.from(parent.childNodes).flatMap((node): JournalNode[] => {
            if (node.nodeType === Node.TEXT_NODE)
                return node.textContent
                    ? [{ type: 'text', text: node.textContent, ...(marks.length ? { marks } : {}) }]
                    : []
            if (!(node instanceof HTMLElement)) return []
            if (node.tagName === 'BR') return [{ type: 'hardBreak' }]
            const type = (
                { STRONG: 'bold', EM: 'italic', S: 'strike', CODE: 'code', A: 'link' } as Record<string, string>
            )[node.tagName]
            return inline(
                node,
                type
                    ? [
                          ...marks,
                          { type, ...(type === 'link' ? { attrs: { href: node.getAttribute('href') ?? '' } } : {}) }
                      ]
                    : marks
            )
        })
    const blocks = (parent: Element): JournalNode[] =>
        Array.from(parent.children).map((node): JournalNode => {
            if (['toggle', 'toggleSummary', 'toggleContent'].includes(node.getAttribute('data-type') ?? ''))
                return {
                    type: node.getAttribute('data-type')!,
                    content: node.getAttribute('data-type') === 'toggleSummary' ? inline(node) : blocks(node)
                }
            if (/^H[1234]$/.test(node.tagName))
                return { type: 'heading', attrs: { level: Number(node.tagName[1]) }, content: inline(node) }
            if (node.tagName === 'HR') return { type: 'horizontalRule' }
            if (node.tagName === 'PRE')
                return {
                    type: 'codeBlock',
                    content: node.textContent ? [{ type: 'text', text: node.textContent }] : []
                }
            if (node.tagName === 'BLOCKQUOTE')
                return {
                    type: 'blockquote',
                    content: node.children.length ? blocks(node) : [{ type: 'paragraph', content: inline(node) }]
                }
            if (node.tagName === 'UL' || node.tagName === 'OL')
                return {
                    type: node.tagName === 'UL' ? 'bulletList' : 'orderedList',
                    content: Array.from(node.children).map((item) => {
                        const copy = item.cloneNode(true) as Element
                        Array.from(copy.children)
                            .filter((child) => ['UL', 'OL'].includes(child.tagName))
                            .forEach((child) => child.remove())
                        return {
                            type: 'listItem',
                            content: [
                                ...(copy.querySelector('p')
                                    ? blocks(copy)
                                    : [{ type: 'paragraph', content: inline(copy) }]),
                                ...Array.from(item.children)
                                    .filter((child) => ['UL', 'OL'].includes(child.tagName))
                                    .flatMap((child) => blocksForList(child))
                            ]
                        }
                    })
                }
            return { type: 'paragraph', content: inline(node) }
        })
    const blocksForList = (element: Element) => {
        const parent = document.createElement('div')
        parent.appendChild(element.cloneNode(true))
        return blocks(parent)
    }
    return { type: 'doc', content: blocks(root) }
}
export function needsLegacyEditor(node: JournalNode): boolean {
    return (
        ['taskList', 'taskItem'].includes(node.type) ||
        !!node.marks?.some((mark) => mark.type === 'underline') ||
        !!node.content?.some(needsLegacyEditor)
    )
}
