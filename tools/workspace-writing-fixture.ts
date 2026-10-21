import { writeFileSync } from 'node:fs'
import { sampleState } from '../src/renderer/workspace-sample'
import type { JournalNode } from '../src/shared/model'
import sharp from 'sharp'
import { createHash, randomFillSync } from 'node:crypto'

const week = '2026-10-12'
const state = sampleState(week)
state.settings.refreshMinutes = 0
state.activities = Array.from({ length: 600 }, (_, index) => ({
    ...structuredClone(state.activities[index % state.activities.length]),
    id: `writing-profile-${index}`
}))
const paragraph = (text: string): JournalNode => ({
    type: 'paragraph',
    ...(text ? { content: [{ type: 'text', text }] } : {})
})
const words =
    'This week we improved the writing workspace and checked nested formatting while background activity refreshed and local saving preserved every change in the journal'.split(
        ' '
    )
let offset = 0
const prose = () => Array.from({ length: 35 }, () => words[offset++ % words.length]).join(' ')
const content: JournalNode[] = []
for (let section = 0; section < 10; section++) {
    content.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `Reflection section ${section}` }]
    })
    content.push(paragraph(prose()), paragraph(prose()), paragraph(prose()))
    content.push({
        type: 'toggle',
        content: [
            { type: 'toggleSummary', content: [{ type: 'text', text: `Details ${section}` }] },
            {
                type: 'toggleContent',
                content: [
                    paragraph(prose()),
                    {
                        type: 'bulletList',
                        content: [0, 1].map(() => ({ type: 'listItem', content: [paragraph(prose())] }))
                    }
                ]
            }
        ]
    })
}
content.push(paragraph(''))
const imageCount = Math.max(0, Math.min(10, Number(process.env.WRITING_IMAGES_COUNT ?? 0)))
if (imageCount) {
    const images = []
    for (let index = 0; index < imageCount; index++) {
        const bytes = await sharp(randomFillSync(Buffer.alloc(1400 * 1000 * 3)), {
            raw: { width: 1400, height: 1000, channels: 3 }
        })
            .png()
            .toBuffer()
        const id = createHash('sha256').update(bytes).digest('hex')
        images.push({ id, mime: 'image/png', width: 1400, height: 1000, bytes: bytes.toString('base64') })
        content.splice(index * 6 + 1, 0, { type: 'image', attrs: { assetId: id, alt: `Large image ${index + 1}` } })
    }
    writeFileSync('.ai-docs/workspace-writing-images.json', JSON.stringify(images))
}
state.settings.template = { type: 'doc', content }
state.drafts = [{ ...state.drafts[0], week, body: state.settings.template, publishedEntryId: undefined }]
state.acquisition = { 'git:sample-repo-0': { status: 'running' } }
writeFileSync('.ai-docs/workspace-writing-profile-fixture.json', JSON.stringify(state))
console.info(JSON.stringify({ words: offset, blocks: content.length, activities: state.activities.length }))
