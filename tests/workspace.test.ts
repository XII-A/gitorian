// @vitest-environment happy-dom
import { parseDiff } from 'react-diff-view'
import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from '../src/renderer/components/arc/rich-text-editor/rich-text-editor'
import {
    activityLink,
    filterWorkspaceActivity,
    journalFromHTML,
    journalHTML,
    needsLegacyEditor
} from '../src/renderer/workspace-model'
import { sampleState } from '../src/renderer/workspace-sample'
import type { JournalNode } from '../src/shared/model'
import { stateSchema } from '../src/shared/model'
import { fromNotion, toNotion } from '../src/shared/notion-format'

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

describe('writing workspace document compatibility', () => {
    it('preserves Arc formatting through local storage and Notion publishing', () => {
        const html =
            '<h2>A useful detour</h2><p><strong>Small</strong> <em>steps</em> <s>first try</s> <code>backoff()</code> <a href="https://github.com/team/app/pull/142">queue PR</a><br>Next line</p><ul><li>Persist the queue<ul><li>Retry interrupted uploads</li></ul></li></ul><ol><li>Review the limits</li></ol><blockquote><p>Try fewer things, carefully.</p><p>Keep the context.</p></blockquote><pre>const delay = 500\n  return delay</pre><hr>'
        const document = journalFromHTML(sanitizeHtml(html))
        expect(journalFromHTML(sanitizeHtml(journalHTML(document)))).toStrictEqual(document)
        const blocks = toNotion(document)
        const withChildren = (items: typeof blocks): typeof blocks =>
            items.map((item) => ({
                ...item,
                children: withChildren((item[item.type] as { children?: typeof blocks }).children ?? [])
            }))

        expect([
            normalize(toNotion(fromNotion(withChildren(blocks)))),
            Object.is(blocks.at(-1)?.type, 'divider')
        ]).toStrictEqual([normalize(blocks), true])
    })

    it('retains legacy checklists and underline by selecting the document editor that supports them', () => {
        const legacy: JournalNode = {
            content: [
                {
                    content: [
                        {
                            attrs: { checked: true },
                            content: [
                                {
                                    content: [{ marks: [{ type: 'underline' }], text: 'Queued safely', type: 'text' }],
                                    type: 'paragraph'
                                }
                            ],
                            type: 'taskItem'
                        }
                    ],
                    type: 'taskList'
                }
            ],
            type: 'doc'
        }
        expect([
            Boolean(needsLegacyEditor(legacy)),
            Boolean(
                needsLegacyEditor({
                    content: [
                        {
                            content: [{ marks: [{ type: 'bold' }], text: 'A reflection', type: 'text' }],
                            type: 'paragraph'
                        }
                    ],
                    type: 'doc'
                })
            ),
            Object.is(toNotion(legacy)[0]?.type, 'to_do')
        ]).toStrictEqual([true, false, true])
    })

    it('escapes captured titles and refuses unsafe links when loading writing', () => {
        const html = journalHTML({
            content: [
                {
                    content: [
                        {
                            marks: [{ attrs: { href: 'javascript:alert(1)' }, type: 'link' }],
                            text: '<img src=x onerror=alert(1)>',
                            type: 'text'
                        }
                    ],
                    type: 'paragraph'
                }
            ],
            type: 'doc'
        })
        expect([
            html?.includes('<img'),
            html?.includes('javascript:'),
            Object.is(journalFromHTML(html).content?.[0]?.content?.[0]?.text, '<img src=x onerror=alert(1)>')
        ]).toStrictEqual([false, false, true])
    })

    it('retains email, phone and internal links supported by the Arc editor', () => {
        const html =
            '<p><a href="mailto:molham@example.com">Email</a> <a href="tel:+905551234567">Phone</a> <a href="#next-week">Next week</a></p>'
        const body = journalFromHTML(sanitizeHtml(html))
        expect(journalFromHTML(sanitizeHtml(journalHTML(body)))).toStrictEqual(body)
    })
})
describe('weekly activity and sample references', () => {
    const state = sampleState('2026-10-05')
    const filters = { branch: 'all', kind: 'all', project: 'all', search: '' }

    it('uses valid, isolated sample data with actual multi-file patches', () => {
        expect([
            Boolean(stateSchema.safeParse(state).success),
            state.activities?.length,
            parseDiff(state.diffs[state.activities[0].id]).map((file) => file.newPath),
            Boolean(state.activities.every((activity) => activity.id.startsWith('sample:2026-10-05:')))
        ]).toStrictEqual([true, 23, ['sync/retry.ts', 'sync/queue.ts', 'sync/retry.test.ts'], true])
    })

    it('combines branch, project and search while keeping work inside its week', () => {
        expect([
            filterWorkspaceActivity(state, '2026-10-05', filters)?.length,
            filterWorkspaceActivity(state, '2026-10-12', filters)?.length
        ]).toStrictEqual([23, 0])
        const found = filterWorkspaceActivity(state, '2026-10-05', {
            ...filters,
            branch: 'feat/offline-queue',
            kind: 'commit',
            project: 'sample-repo-0',
            search: 'backoff'
        })
        expect([
            found.map((activity) => activity.id),
            Boolean(
                filterWorkspaceActivity(state, '2026-10-05', { ...filters, kind: 'pr' }).every(
                    (activity) => activity.kind !== 'commit'
                )
            )
        ]).toStrictEqual([['sample:2026-10-05:0'], true])
    })

    it('matches any author tag without losing project, branch or week filters', () => {
        const authored = {
            ...state,
            activities: state.activities.map((activity, index) => ({
                ...activity,
                author: index === 0 ? 'Alice@example.com' : 'bob@example.com'
            }))
        }
        const selected = { ...filters, branch: 'feat/offline-queue', project: 'sample-repo-0' }
        expect([
            filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE'] }).map((item) => item.id),
            filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['ALICE', 'bob'] }),
            filterWorkspaceActivity(authored, '2026-10-12', { ...selected, authors: ['alice'] }),
            filterWorkspaceActivity(authored, '2026-10-05', { ...selected, authors: ['unknown'] })
        ]).toStrictEqual([['sample:2026-10-05:0'], filterWorkspaceActivity(authored, '2026-10-05', selected), [], []])
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
