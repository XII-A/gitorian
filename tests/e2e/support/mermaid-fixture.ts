import { initialState, type Activity } from '../../../src/shared/model'

export const flow =
    'flowchart LR\n    Draft[Write draft] --> Review{Review}\n    Review -->|Approved| Publish[Publish entry]\n    Review -->|Changes| Draft\n'
const sequence =
    'sequenceDiagram\n    participant UI as Journal\n    participant Store as Local store\n    UI->>Store: Save draft\n    Store-->>UI: Saved\n'
const fence = (source: string, language = 'mermaid') => '```' + language + '\n' + source + '\n```'
export const description = [
    '## Publishing a journal entry',
    'Review the draft before publishing. Drafts stay local until approved.',
    fence(flow),
    '### Local persistence',
    fence(sequence),
    '| Stage | Owner |\n| --- | --- |\n| Review | Author |',
    fence('const draft = await save();', 'ts'),
    fence('- old\n+ new', 'diff')
].join('\n\n')
export const state = initialState()
state.settings.refreshMinutes = 0
// Repository metadata is needed by activity filtering; no Git directory or external provider is used.
state.repositories = [
    {
        id: 'fixture',
        name: 'journal-workflows',
        path: '',
        remote: '',
        base: 'main',
        trackingStart: '2026-01-01',
        emails: [],
        available: false,
        removed: false,
        branchBases: {},
        branches: ['main']
    }
]
const activity = (id: string, title: string, body: string): Activity => ({
    id,
    title,
    description: body,
    kind: 'change-request',
    repositoryId: 'fixture',
    date: new Date().toISOString(),
    author: 'fixture-author',
    branches: ['main'],
    files: [],
    filesLoaded: true,
    disposition: 'inbox',
    explicit: false,
    deletedBranches: [],
    changeRequest: { status: 'open', openedAt: new Date().toISOString(), commitDates: [] }
})
state.activities = [
    activity('valid', 'Mermaid publishing workflow', description),
    activity(
        'invalid',
        'Invalid Mermaid recovery',
        [fence('flowchart LR\n A['), fence(''), fence('x'.repeat(50_001))].join('\n\n')
    ),
    activity(
        'untrusted',
        'Untrusted Mermaid content',
        fence(
            '%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\n A[Safe label] --> B[Another label]\n click A "https://example.invalid/" "Open"'
        )
    )
]
