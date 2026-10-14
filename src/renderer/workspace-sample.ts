import type { Activity, State } from '../shared/model'
import { initialState } from '../shared/model'
import { offsetDay } from './hub-model'

const patch = `diff --git a/sync/retry.ts b/sync/retry.ts
index 1111111..2222222 100644
--- a/sync/retry.ts
+++ b/sync/retry.ts
@@ -1,8 +1,13 @@
 const MAX_ATTEMPTS = 5
-const DELAY_MS = 1000
+const BASE_DELAY_MS = 500
+const MAX_DELAY_MS = 30_000
 
 export async function flushBatch(batch: Batch, attempt = 0) {
   const res = await upload(batch)
-  if (!res.ok) throw new SyncError(res.status)
+  if (!res.ok) {
+    if (attempt >= MAX_ATTEMPTS) throw new SyncError(res.status)
+    await sleep(backoff(attempt))
+    return flushBatch(batch, attempt + 1)
+  }
   return res.json()
 }
@@ -10,1 +15,7 @@
 export type Batch = { id: string; items: Item[] }
+
+function backoff(attempt: number) {
+  const delay = BASE_DELAY_MS * 2 ** attempt
+  const jitter = Math.random() * 250
+  return Math.min(delay + jitter, MAX_DELAY_MS)
+}
diff --git a/sync/queue.ts b/sync/queue.ts
index 1111111..2222222 100644
--- a/sync/queue.ts
+++ b/sync/queue.ts
@@ -1,3 +1,4 @@
 export async function enqueue(batch: Batch) {
-  pending.push(batch)
+  await storage.put(batch.id, batch)
+  pending.push({ ...batch, attempt: 0 })
 }
diff --git a/sync/retry.test.ts b/sync/retry.test.ts
index 1111111..2222222 100644
--- a/sync/retry.test.ts
+++ b/sync/retry.test.ts
@@ -1,2 +1,3 @@
 test('keeps failed batches queued', async () => {
+  expect(await queue.pending()).toHaveLength(1)
 })
`
const titles = [
    'Retry failed sync batches with backoff',
    'Offline queue: persist pending uploads',
    'Mirror survey builder toolbar for RTL',
    'Keep upload progress after reconnecting',
    'Add retry coverage for interrupted batches',
    'Review the offline queue changes',
    'Make connection errors easier to understand',
    'Save survey responses before uploading',
    'Preserve draft answers on navigation',
    'Queue attachments until the connection returns',
    'Simplify the upload status indicator',
    'Update the survey preview layout',
    'Review the retry strategy',
    'Document the sync state transitions',
    'Handle expired upload tokens',
    'Add a reconnect event to the queue',
    'Fix focus order in the survey builder',
    'Keep field labels aligned in RTL',
    'Extract the batch upload helper',
    'Add an offline scenario to the test suite',
    'Trim redundant sync requests',
    'Clarify empty survey states',
    'Start the persistent upload queue'
]
export const sampleState = (week: string): State => {
    const state = initialState()
    state.settings.timezone = 'Europe/Istanbul'
    state.repositories = ['mobile-app', 'survey-builder', 'developer-docs'].map((name, index) => ({
        available: true,
        base: 'main',
        branchBases: {},
        branches: ['main', 'feat/offline-queue', 'fix/rtl-toolbar'],
        emails: ['molham@example.com'],
        id: `sample-repo-${index}`,
        name,
        path: '',
        remote: `https://github.com/weekly-j-example/${name}`,
        removed: false,
        trackingStart: week
    }))
    state.activities = titles.map((title, index): Activity => ({
        id: `sample:${week}:${index}`,
        repositoryId: `sample-repo-${(() => {
            if (index < 8) {
                return 0
            }
            if (index < 18) {
                return 1
            }
            return 2
        })()}`,
        kind: (() => {
            if (index === 1) {
                return 'merged'
            }
            if ([5, 12].includes(index)) {
                return 'review'
            }
            if ([8, 15, 22].includes(index)) {
                return 'pr'
            }

            return 'commit'
        })(),
        title,
        date: `${offsetDay(
            week,
            (() => {
                if (index < 3) {
                    return 4
                }
                if (index < 8) {
                    return 3
                }
                if (index < 14) {
                    return 2
                }

                if (index < 19) {
                    return 1
                }

                return 0
            })()
        )}T${String(14 - (index % 6)).padStart(2, '0')}:14:00+03:00`,
        author: 'Molham',
        branches: [
            (() => {
                if (index < 8) {
                    return 'feat/offline-queue'
                }
                if (index < 18) {
                    return 'fix/rtl-toolbar'
                }
                return 'main'
            })()
        ],
        sha: index === 0 ? 'a3f9c218912ab0' : `7be01d${index.toString(16)}8912ab0`,
        ...(index === 1 || [8, 15, 22].includes(index)
            ? {
                  prId: `sample/pr/${142 - index}`,
                  url: `https://github.com/weekly-j-example/mobile-app/pull/${142 - index}`
              }
            : {}),
        description:
            index === 0
                ? 'Failed batches were dropped after the first error. Retry up to five times with exponential backoff and jitter, and keep the batch queued until it succeeds or runs out of attempts.'
                : `${title}. A small change toward a more dependable survey experience.`,
        files: [
            { name: 'sync/retry.ts', status: 'M' },
            { name: 'sync/queue.ts', status: 'M' },
            { name: 'sync/retry.test.ts', status: 'M' }
        ],
        base: 'main',
        disposition: 'inbox',
        explicit: false,
        deletedBranches: []
    }))
    state.diffs = Object.fromEntries(state.activities.map((activity) => [activity.id, patch]))
    state.features = [
        {
            archived: false,
            id: 'sample-offline',
            members: state.activities.slice(0, 8).map((activity) => activity.id),
            name: 'Offline reliability'
        }
    ]
    state.drafts = [
        {
            body: {
                content: [
                    {
                        content: [
                            {
                                text: 'Most of the week went to one stubborn problem: uploads that quietly died on flaky connections. I started Monday with a vague theory and ended Friday with a retry strategy I actually trust.',
                                type: 'text'
                            }
                        ],
                        type: 'paragraph'
                    },
                    {
                        content: [
                            {
                                marks: [
                                    {
                                        attrs: {
                                            href: 'https://github.com/weekly-j-example/mobile-app/commit/a3f9c218912ab0'
                                        },
                                        type: 'link'
                                    }
                                ],
                                text: 'Retry failed sync batches',
                                type: 'text'
                            },
                            {
                                text: ' is the change that finally made it behave. The offline queue landed this morning, so queued uploads now survive a restart.',
                                type: 'text'
                            }
                        ],
                        type: 'paragraph'
                    },
                    { attrs: { level: 2 }, content: [{ text: 'A useful detour', type: 'text' }], type: 'heading' },
                    {
                        content: [
                            {
                                text: 'The detour I didn’t plan for was RTL. Mirroring the builder toolbar exposed three layout assumptions I’d baked in months ago. Annoying, but better found now than by a user.',
                                type: 'text'
                            }
                        ],
                        type: 'paragraph'
                    },
                    {
                        content: [
                            {
                                text: 'What surprised me about the backoff was how little code it took once I stopped treating every failure the same. A dropped connection and a rejected payload want different answers, and the first version of the retry loop pretended otherwise.',
                                type: 'text'
                            }
                        ],
                        type: 'paragraph'
                    },
                    { type: 'paragraph' }
                ],
                type: 'doc'
            },
            id: `sample-draft-${week}`,
            selections: [],
            title: 'The week the sync finally held',
            updatedAt: `${week}T12:00:00Z`,
            week
        }
    ]
    state.entries = [
        {
            body: {
                content: [
                    {
                        content: [
                            {
                                text: 'Last week I mapped the places where a weak connection interrupted a survey. This week is about giving those answers somewhere safe to wait.',
                                type: 'text'
                            }
                        ],
                        type: 'paragraph'
                    }
                ],
                type: 'doc'
            },
            date: offsetDay(week, -7),
            id: 'sample-entry',
            refreshedAt: `${week}T12:00:00Z`,
            title: 'Making space for offline work',
            url: 'https://notion.so/example'
        }
    ]
    return state
}
