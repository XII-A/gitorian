import type { Activity, JournalNode, State } from '../shared/model'
import { offsetDay, rangeActivities } from './hub-model'

export const dateValue = (value: string) => new Date(`${value}T12:00:00`)
export const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const formatDay = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
    dateValue(date).toLocaleDateString('en-US', options)
export const filterWorkspaceActivity = (
    state: State,
    start: string,
    filters: { project: string; branch: string; kind: string; search: string; authors?: string[] }
) =>
    rangeActivities(state, start, offsetDay(start, 6)).filter(
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

export const activityLink = (activity: Activity, state: State) => {
    if (activity.url) {
        return activity.url
    }
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    const remote = repository?.remote.replace(/^git@github.com:/u, 'https://github.com/').replace(/\.git$/u, '')
    return activity.sha && remote?.startsWith('https://github.com/') ? `${remote}/commit/${activity.sha}` : undefined
}
const escapeHTML = (text: string) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
export const journalHTML = (node: JournalNode): string => {
    const content = (node.content ?? []).map(journalHTML).join('')
    if (node.type === 'text') {
        return (node.marks ?? []).reduce(
            (text, mark) => {
                const tag = (
                    { bold: 'strong', code: 'code', italic: 'em', strike: 's', underline: 'u' } as Record<
                        string,
                        string
                    >
                )[mark.type]
                if (tag) {
                    return `<${tag}>${text}</${tag}>`
                }
                if (
                    mark.type === 'link' &&
                    typeof mark.attrs?.href === 'string' &&
                    /^(?<group1>https?:|mailto:|tel:|\/|#)/iu.test(mark.attrs.href)
                ) {
                    return `<a href="${escapeHTML(mark.attrs.href)}">${text}</a>`
                }
                return text
            },
            escapeHTML(node.text ?? '')
        )
    }
    if (node.type === 'doc') {
        return content
    }
    if (node.type === 'hardBreak') {
        return '<br>'
    }
    if (node.type === 'horizontalRule') {
        return '<hr>'
    }
    if (node.type === 'codeBlock') {
        return `<pre>${content}</pre>`
    }
    const tag =
        node.type === 'heading'
            ? `h${Math.min(3, Number(node.attrs?.level ?? 1))}`
            : (
                  {
                      blockquote: 'blockquote',
                      bulletList: 'ul',
                      listItem: 'li',
                      orderedList: 'ol',
                      paragraph: 'p',
                      taskItem: 'li',
                      taskList: 'ul'
                  } as Record<string, string>
              )[node.type]
    return tag ? `<${tag}>${content}</${tag}>` : content
}
export const journalFromHTML = (html: string): JournalNode => {
    const root = new DOMParser().parseFromString(html, 'text/html').body
    const inline = (parent: Node, marks: NonNullable<JournalNode['marks']> = []): JournalNode[] =>
        [...parent.childNodes].flatMap((node): JournalNode[] => {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent
                    ? [{ text: node.textContent, type: 'text', ...(marks.length ? { marks } : {}) }]
                    : []
            }
            if (!(node instanceof HTMLElement)) {
                return []
            }
            if (node.tagName === 'BR') {
                return [{ type: 'hardBreak' }]
            }
            const type = (
                { A: 'link', CODE: 'code', EM: 'italic', S: 'strike', STRONG: 'bold' } as Record<string, string>
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
    const blocksForList = (element: Element) => {
        const parent = document.createElement('div')
        parent.append(element.cloneNode(true))
        return blocks(parent)
    }

    const blocks = (parent: Element): JournalNode[] =>
        [...parent.children].map((node): JournalNode => {
            if (/^H[123]$/u.test(node.tagName)) {
                return { attrs: { level: Number(node.tagName[1]) }, content: inline(node), type: 'heading' }
            }
            if (node.tagName === 'HR') {
                return { type: 'horizontalRule' }
            }
            if (node.tagName === 'PRE') {
                return {
                    content: node.textContent ? [{ text: node.textContent, type: 'text' }] : [],
                    type: 'codeBlock'
                }
            }
            if (node.tagName === 'BLOCKQUOTE') {
                return {
                    content: node.children.length ? blocks(node) : [{ content: inline(node), type: 'paragraph' }],
                    type: 'blockquote'
                }
            }
            if (node.tagName === 'UL' || node.tagName === 'OL') {
                return {
                    content: [...node.children].map((item) => {
                        const copy = item.cloneNode(true) as Element
                        for (const child of [...copy.children].filter((childValue) =>
                            ['UL', 'OL'].includes(childValue.tagName)
                        )) {
                            child.remove()
                        }
                        return {
                            content: [
                                ...(copy.querySelector('p')
                                    ? blocks(copy)
                                    : [{ content: inline(copy), type: 'paragraph' }]),
                                ...[...item.children]
                                    .filter((child) => ['UL', 'OL'].includes(child.tagName))
                                    .flatMap((child) => blocksForList(child))
                            ],
                            type: 'listItem'
                        }
                    }),
                    type: node.tagName === 'UL' ? 'bulletList' : 'orderedList'
                }
            }
            return { content: inline(node), type: 'paragraph' }
        })

    return { content: blocks(root), type: 'doc' }
}
export const needsLegacyEditor = (node: JournalNode): boolean =>
    ['taskList', 'taskItem'].includes(node.type) ||
    !!node.marks?.some((mark) => mark.type === 'underline') ||
    !!node.content?.some(needsLegacyEditor)
