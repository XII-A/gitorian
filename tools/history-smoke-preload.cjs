const { contextBridge } = require('electron')

// Test-only journal bridge. No preview entries are bundled into the app.
const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const entries = [
    {
        id: 'smoke-long',
        title: 'Long weekly entry',
        date: '2026-10-12',
        body: {
            type: 'doc',
            content: Array.from({ length: 40 }, (_, index) =>
                paragraph(
                    `Section ${index + 1}. This week I worked through the journal reader, checked its scrolling, and revisited earlier entries. The content should remain readable and return intact after choosing a different week.`
                )
            )
        }
    },
    {
        id: 'smoke-short',
        title: 'Short weekly entry',
        date: '2026-10-05',
        body: {
            type: 'doc',
            content: [paragraph('A short entry for checking that switching weeks updates the entire document.')]
        }
    }
].map((entry) => ({ ...entry, url: '', refreshedAt: `${entry.date}T12:00:00Z` }))
const state = {
    version: 1,
    repositories: [],
    activities: [],
    drafts: [],
    entries,
    coverage: [],
    revisions: [],
    diffs: {},
    saves: [],
    settings: {
        weekStart: 1,
        timezone: 'UTC',
        refreshMinutes: 0,
        template: { type: 'doc', content: [paragraph('')] },
        githubLogin: '',
        layout: { order: ['activity', 'draft', 'details'], hidden: [], sizes: { activity: 24, draft: 46, details: 30 } }
    }
}
contextBridge.exposeInMainWorld('journal', {
    invoke: async (command) => ({
        state,
        connections: { remote: false, notion: false, protectedStorage: false },
        ...(command.type === 'entryHistory'
            ? {
                  entryPage: {
                      items: entries
                          .filter((entry) => JSON.stringify(entry).toLowerCase().includes(command.query.toLowerCase()))
                          .map(({ body, ...entry }) => ({
                              ...entry,
                              excerpt: body.content[0].content[0].text.slice(0, 200)
                          }))
                  }
              }
            : {}),
        ...(command.type === 'entry' ? { entry: entries.find((entry) => entry.id === command.id) } : {})
    })
})
