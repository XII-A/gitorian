import type { State, JournalNode } from '../shared/model'

const paragraph = (text: string): JournalNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (text: string): JournalNode => ({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }]
})

// Preview-only records. They never enter saved state or get sent to Notion.
export const historySamples: State['entries'] = [
    [
        '2026-10-12',
        'Finding a quieter rhythm',
        'This week felt less like chasing loose ends and more like making room for the work that matters. I finished the journal history flow and spent a little longer on the details people notice without knowing why.',
        'What moved forward',
        'The offline queue now recovers cleanly after a dropped connection. I also simplified the review flow so a decision and its context stay together. Fewer clicks, fewer places to lose your train of thought.',
        'A small lesson',
        'I kept reaching for another setting when the better answer was a clearer default. Removing one choice made the whole screen easier to understand.',
        'Next week',
        'Take the new flow through a real week of work. Watch where I hesitate, write down the rough edges, and resist adding anything until those are fixed.'
    ],
    [
        '2026-10-05',
        'Making space for offline work',
        'Last week I mapped the places where a weak connection interrupted a survey. This week was about giving those answers somewhere safe to wait.',
        'Shipped this week',
        'A durable local queue, clearer sync feedback, and retries that distinguish a dropped connection from a rejected payload.',
        'What I learned',
        'Reliability is often about making the waiting understandable. The team needs to know their work is safe before they need to know when it will sync.'
    ],
    [
        '2026-09-28',
        'The details that make it feel finished',
        'A week of small improvements: calmer empty states, better keyboard navigation, and a much more useful activity timeline.',
        'Worth remembering',
        'Testing with a long project name caught three layout problems that the tidy mockups had hidden. Realistic content is part of the design.'
    ],
    [
        '2026-09-21',
        'A clearer view of the week',
        'Brought commits, pull requests, and reviews into one timeline. The first version had too much information; the second finally made the important things easy to see.',
        'Next steps',
        'Try the timeline with two active repositories and check whether the project filters still feel useful.'
    ],
    [
        '2026-09-14',
        'Fewer steps, better defaults',
        'Simplified repository setup and removed a confirmation that was slowing everyone down. The new defaults match the way we already work.',
        'A good conversation',
        'A short pairing session surfaced more than a long list of settings ever could.'
    ],
    [
        '2026-08-31',
        'Building the first useful version',
        'Connected the local journal to Notion and published the first complete weekly entry. There are rough edges, but the loop works from discovery to reflection.',
        'Looking ahead',
        'Make saving feel dependable, then focus on browsing older entries.'
    ]
].map(([date, title, intro, ...sections], index) => ({
    id: `history-sample-${index}`,
    date,
    title,
    url: '',
    refreshedAt: `${date}T12:00:00Z`,
    body: {
        type: 'doc',
        content: [paragraph(intro), ...sections.map((text, i) => (i % 2 === 0 ? heading(text) : paragraph(text)))]
    }
}))
