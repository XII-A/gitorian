import type { State, JournalNode } from '../shared/model'

const paragraph = (text: string): JournalNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (text: string): JournalNode => ({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }]
})
const bullets = (items: string[]): JournalNode => ({
    type: 'bulletList',
    content: items.map((text) => ({ type: 'listItem', content: [paragraph(text)] }))
})

// One temporary, read-only preview entry for checking long-document scrolling.
// It is composed into the history view and never persisted or published.
export const historySamples: State['entries'] = [
    {
        id: 'history-sample-long',
        title: 'Finding a quieter rhythm',
        date: '2026-10-12',
        url: '',
        refreshedAt: '2026-10-12T12:00:00Z',
        body: {
            type: 'doc',
            content: [
                paragraph(
                    'This week felt less like chasing loose ends and more like making room for the work that matters. I finished the journal history flow and spent a little longer on the details people notice without knowing why. This long sample brings the whole week together: what shipped, what changed, and what I want to carry into the next one.'
                ),
                heading('What moved forward'),
                paragraph(
                    'The offline queue now recovers cleanly after a dropped connection. I also simplified the review flow so a decision and its context stay together. Fewer clicks, fewer places to lose your train of thought. The most useful change was making the status understandable before adding any more controls. A person should be able to leave the screen knowing their work is safe.'
                ),
                bullets([
                    'Finished the first complete pass of the previous entries reader.',
                    'Made the local save queue survive a restart without duplicating work.',
                    'Reviewed the keyboard path from the weekly overview into an older entry.',
                    'Removed settings that were compensating for an unclear default.'
                ]),
                heading('Monday: make the waiting understandable'),
                paragraph(
                    'I began by tracing every transition between writing locally and publishing remotely. The code had names for each stage, but the interface showed almost all of them as the same spinner. That made it difficult to tell whether the app was waiting for a connection, processing the request, or already finished. I wrote down the questions someone might ask at each stage and used those questions to decide what needed to be visible.'
                ),
                paragraph(
                    'The resulting change was small. A saved draft says where it lives, a pending publish says what it is waiting for, and an interrupted request offers a clear next action. There is still room to improve the recovery path, but the normal path no longer requires understanding the implementation. That feels like the right kind of progress.'
                ),
                heading('Tuesday: put context beside the decision'),
                paragraph(
                    'The review session surfaced a pattern I had missed: people were opening a detail, checking the list again, and then reopening the same detail. They were using the list as context rather than treating it as a destination. Keeping both surfaces available made that movement much easier. The selected row stays visible while the entry can be read at a comfortable width.'
                ),
                {
                    type: 'blockquote',
                    content: [
                        paragraph(
                            'If someone keeps going back to the previous screen, the missing thing may be context rather than navigation.'
                        )
                    ]
                },
                paragraph(
                    'I tested the flow with several differently shaped entries. One contained only a paragraph; another had a long title, several headings, a list of decisions, and a code snippet. The content changed the balance of the screen more than any decorative detail. It was a useful reminder to design with realistic writing early rather than treating it as a final step.'
                ),
                heading('Wednesday: fewer choices, clearer defaults'),
                paragraph(
                    'I kept reaching for another setting when the better answer was a clearer default. Removing one choice made the whole screen easier to understand. Instead of asking which kind of activity to show first, the overview now begins with the work that needs attention. The filters remain available, but the first view makes a useful decision for the reader.'
                ),
                bullets([
                    'Show the newest entries first, with a clear date on every row.',
                    'Keep searching predictable across both titles and body text.',
                    'Retain the current entry while the list is filtered.',
                    'Use one consistent close behavior across mouse and keyboard input.'
                ]),
                paragraph(
                    'We also looked at the language around saving. Technical accuracy mattered, but the longest explanation was rarely the clearest one. A short statement about what happened, followed by one useful action when something needs attention, proved much easier to scan. The same principle helped with empty states and connection errors.'
                ),
                heading('Thursday: the small details are part of the work'),
                paragraph(
                    'Most of Thursday went into details that would not appear in a feature checklist: a scrollbar that covered a row, a focus indicator clipped by a container, a tooltip arriving too quickly, and a close button that moved with the content. Individually they were easy to overlook. Together they changed whether the interface felt dependable.'
                ),
                paragraph(
                    'I compared the same flow at a wide desktop size and a narrow phone size. On the smaller view, the reader needs to use the available space without making the content feel cramped. On desktop, the relationship between list and reader should remain obvious. Matching their height and keeping a consistent gap helped both layouts feel intentional.'
                ),
                heading('A small implementation note'),
                paragraph(
                    'The queue became easier to reason about once the retry decision was separated from the request itself. A rejected payload and a lost connection need different answers. The first version of the loop treated every failure as temporary, which made the happy path look simple while hiding the difficult cases.'
                ),
                {
                    type: 'codeBlock',
                    attrs: { language: 'typescript' },
                    content: [
                        {
                            type: 'text',
                            text: 'async function publishWhenReady(entry: Entry) {\n    await saveLocally(entry)\n    if (!connection.isAvailable()) return queue(entry)\n    return publish(entry)\n}'
                        }
                    ]
                },
                paragraph(
                    'The important part is not the number of lines. It is that each step has one clear responsibility and a useful result. Saving locally happens before a network request starts. Queuing is an expected outcome, and publishing can report its own failure without making the local draft disappear. That separation made the recovery behavior easier to test.'
                ),
                heading('Friday: test the whole journey'),
                paragraph(
                    'I finished the week by walking through the product from a fresh start. Add a repository, review its activity, open the writing workspace, save a draft, and revisit an older entry. Each piece had worked in isolation, but moving between them exposed assumptions about focus, scrolling, and which week was selected. Those seams deserve as much attention as the main screens.'
                ),
                paragraph(
                    'One useful exercise was to stop after every action and ask what I expected to happen next. Sometimes the answer was obvious from the interface. Sometimes I only knew because I had written the code. The second category became a short list of follow-up work. It is a practical way to find places where the product is asking too much of its user.'
                ),
                heading('What I want to remember'),
                bullets([
                    'Realistic content is part of the design, not a finishing task.',
                    'Make the waiting understandable before trying to make it look faster.',
                    'A good default can remove more complexity than a new setting.',
                    'Test transitions between features, not only the features themselves.',
                    'Keep enough context visible that people can make the next decision.'
                ]),
                paragraph(
                    'The best moments this week came from removing small interruptions. A predictable save, an entry that opens where it is expected, a list that remains usable while reading: none of these is dramatic, but they make it easier to stay with a thought. I want to keep using that as a measure of whether a change is helping.'
                ),
                heading('Next week'),
                paragraph(
                    'Take the new flow through a real week of work. Watch where I hesitate, write down the rough edges, and resist adding anything until those are fixed. I want to spend a little more time with longer entries, keyboard navigation, and the places where a weak connection changes the experience. The goal is a journal that is easy to return to, even when the week itself was messy.'
                ),
                paragraph(
                    'This is the end of the sample entry. Reaching this paragraph should leave the final lines comfortably visible above the lower edge, with the scrollbar beside the content and the close control still reachable at the top of the dialog.'
                )
            ]
        }
    }
]
