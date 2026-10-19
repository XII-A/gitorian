// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseDiff } from 'react-diff-view'
import { sampleState } from '../src/renderer/workspace-sample'
import {
    activityLink,
    filterWorkspaceActivity,
    journalFromHTML,
    journalHTML,
    needsLegacyEditor
} from '../src/renderer/workspace-model'
import { stateSchema } from '../src/shared/model'
import type { JournalNode } from '../src/shared/model'
import { fromNotion, toNotion } from '../src/shared/notion-format'
import { sanitizeHtml } from '../src/renderer/components/arc/rich-text-editor/rich-text-editor'

describe('writing workspace document compatibility', () => {
    it('preserves Arc formatting through local storage and Notion publishing', () => {
        const html =
            '<h2>A useful detour</h2><p><strong>Small</strong> <em>steps</em> <s>first try</s> <code>backoff()</code> <a href="https://github.com/team/app/pull/142">queue PR</a><br>Next line</p><ul><li>Persist the queue<ul><li>Retry interrupted uploads</li></ul></li></ul><ol><li>Review the limits</li></ol><blockquote><p>Try fewer things, carefully.</p><p>Keep the context.</p></blockquote><pre>const delay = 500\n  return delay</pre><hr>'
        const document = journalFromHTML(sanitizeHtml(html))
        expect(journalFromHTML(sanitizeHtml(journalHTML(document)))).toEqual(document)
        const blocks = toNotion(document)
        const withChildren = (items: typeof blocks): typeof blocks =>
            items.map((item) => ({
                ...item,
                children: withChildren((item[item.type] as { children?: typeof blocks }).children ?? [])
            }))
        const normalize = (value: unknown) =>
            JSON.parse(
                JSON.stringify(value, (key, data: unknown) => {
                    if (key === 'annotations' && data && typeof data === 'object') {
                        const enabled = Object.fromEntries(Object.entries(data).filter(([, active]) => active))
                        return Object.keys(enabled).length ? enabled : undefined
                    }
                    return data
                })
            ) as unknown
        expect(normalize(toNotion(fromNotion(withChildren(blocks))))).toEqual(normalize(blocks))
        expect(blocks.at(-1)?.type).toBe('divider')
    })
    it('retains legacy checklists and underline by selecting the document editor that supports them', () => {
        const legacy: JournalNode = {
            type: 'doc',
            content: [
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: true },
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Queued safely', marks: [{ type: 'underline' }] }]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        expect(needsLegacyEditor(legacy)).toBe(true)
        expect(
            needsLegacyEditor({
                type: 'doc',
                content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'A reflection', marks: [{ type: 'bold' }] }] }
                ]
            })
        ).toBe(false)
        expect(toNotion(legacy)[0]?.type).toBe('to_do')
    })
    it('escapes captured titles and refuses unsafe links when loading writing', () => {
        const html = journalHTML({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: '<img src=x onerror=alert(1)>',
                            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
                        }
                    ]
                }
            ]
        })
        expect(html).not.toContain('<img')
        expect(html).not.toContain('javascript:')
        expect(journalFromHTML(html).content?.[0]?.content?.[0]?.text).toBe('<img src=x onerror=alert(1)>')
    })
    it('retains email, phone and internal links supported by the Arc editor', () => {
        const html =
            '<p><a href="mailto:alex@example.com">Email</a> <a href="tel:+12025550123">Phone</a> <a href="#next-week">Next week</a></p>'
        const body = journalFromHTML(sanitizeHtml(html))
        expect(journalFromHTML(sanitizeHtml(journalHTML(body)))).toEqual(body)
    })
})
describe('weekly activity and sample references', () => {
    const state = sampleState('2026-10-05')
    const filters = { project: 'all', branch: 'all', kind: 'all', search: '' }
    it('uses valid, isolated sample data with actual multi-file patches', () => {
        expect(stateSchema.safeParse(state).success).toBe(true)
        expect(state.activities).toHaveLength(23)
        expect(parseDiff(state.diffs[state.activities[0].id]).map((file) => file.newPath)).toEqual([
            'sync/retry.ts',
            'sync/queue.ts',
            'sync/retry.test.ts'
        ])
        expect(state.activities.every((activity) => activity.id.startsWith('sample:2026-10-05:'))).toBe(true)
    })
    it('combines branch, project and search while keeping work inside its week', () => {
        expect(filterWorkspaceActivity(state, '2026-10-05', filters)).toHaveLength(23)
        expect(filterWorkspaceActivity(state, '2026-10-12', filters)).toHaveLength(0)
        const found = filterWorkspaceActivity(state, '2026-10-05', {
            ...filters,
            project: 'sample-repo-0',
            branch: 'feat/offline-queue',
            kind: 'commit',
            search: 'backoff'
        })
        expect(found.map((activity) => activity.id)).toEqual(['sample:2026-10-05:0'])
        expect(
            filterWorkspaceActivity(state, '2026-10-05', { ...filters, kind: 'pr' }).every(
                (activity) => activity.kind !== 'commit'
            )
        ).toBe(true)
    })
    it('matches any author tag without losing project, branch or week filters', () => {
        const authored = {
            ...state,
            activities: state.activities.map((activity, index) => ({
                ...activity,
                author: index === 0 ? 'Alice@example.com' : 'bob@example.com'
            }))
        }
        const selected = { ...filters, project: 'sample-repo-0', branch: 'feat/offline-queue' }
        expect(
            filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE'] }).map((item) => item.id)
        ).toEqual(['sample:2026-10-05:0'])
        expect(filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE', 'bob'] })).toEqual(
            filterWorkspaceActivity(authored, '2026-10-05', selected)
        )
        expect(filterWorkspaceActivity(authored, '2026-10-12', { ...selected, authors: ['alice'] })).toEqual([])
        expect(filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['unknown'] })).toEqual([])
    })
    it('generates a commit citation only from a web GitHub remote and preserves explicit PR links', () => {
        expect(activityLink(state.activities[0], state)).toBe(
            'https://github.com/weekly-j-example/mobile-app/commit/a3f9c218912ab0'
        )
        expect(activityLink(state.activities[1], state)).toBe(state.activities[1].url)
        const local = structuredClone(state)
        local.repositories[0].remote = 'C:\\work\\mobile-app'
        expect(activityLink(local.activities[0], local)).toBeUndefined()
    })
})
