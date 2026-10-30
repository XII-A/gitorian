// Dev-only isolated props fixture. No preload, database, provider or personal journal access.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { WorkspaceDraft } from './WorkspaceDraft'
import { ToastStackProvider } from './components/arc/toast-stack/toast-stack'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { sampleState } from '../../tests/workspace-fixture'
import type { Command, JournalNode, Reply } from '../shared/model'
import '@fontsource-variable/geist'
import '@fontsource-variable/inter'
import './components/arc/foundation.css'
import './styles.css'
import './workspace.css'

const week = '2026-10-12'
const options = [
    { value: 'demo', label: 'Demo data' },
    { value: 'worst', label: 'Worst case' },
    { value: 'empty', label: 'Empty' },
    { value: 'one', label: 'One' },
    { value: 'huge', label: '1,000 blocks' }
]
const paragraph = (text: string): JournalNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const noop = () => undefined
function Fixture() {
    const params = new URLSearchParams(location.search)
    const [mode, setMode] = useState(params.get('data') ?? 'demo')
    const [state, setState] = useState(() => {
        const value = sampleState(week)
        value.restoreId = `break-writing-${mode}`
        value.drafts[0].id = `break-writing-${mode}`
        if (mode === 'worst') {
            value.drafts[0].title =
                'Aleksandra Wiśniewska-Kowalczyk: customer-feedback-from-enterprise-onboarding and international launch retrospective, accessibility review, outstanding decisions and follow-up commitments'
            value.drafts[0].body = {
                type: 'doc',
                content: [
                    paragraph('bartholomew.fitzgerald@northwind-industries-holdings.example.com'),
                    paragraph(
                        'https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved'
                    ),
                    paragraph('Jo'),
                    paragraph('J'),
                    paragraph('Đặng Thị Ngọc Hân · 王秀英 · 👩🏽‍💻 Priya'),
                    paragraph('نور الهدى عبد الرحمن: مراجعة الكتابة لهذا الأسبوع'),
                    paragraph('<b>Literal text</b> &amp; **not a mark**'),
                    {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Benachrichtigungseinstellungen' }]
                    },
                    {
                        type: 'codeBlock',
                        attrs: { language: 'typescript' },
                        content: [
                            {
                                type: 'text',
                                text: 'const destination = "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved"'
                            }
                        ]
                    },
                    {
                        type: 'image',
                        attrs: {
                            assetId: '0123456789abcdef'.repeat(4),
                            alt: 'Customer-feedback-from-enterprise-onboarding: international launch review',
                            caption: 'Customer-feedback-from-enterprise-onboarding: international launch review'
                        }
                    },
                    paragraph('A realistic pasted retrospective. '.repeat(70))
                ]
            }
        }
        if (mode === 'empty') value.drafts = []
        if (mode === 'one') {
            value.drafts[0].title = ''
            value.drafts[0].body = { type: 'doc', content: [paragraph('Hello')] }
        }
        if (mode === 'huge')
            value.drafts[0].body = {
                type: 'doc',
                content: Array.from({ length: 1000 }, (_, i) =>
                    paragraph(
                        `Reflection ${i + 1}. We reviewed international onboarding and preserved local writing while discussing next steps.`
                    )
                )
            }
        return value
    })
    const run = (command: Command): Promise<Reply | undefined> => {
        if (command.type === 'draft') {
            const saved = { ...command.draft, version: command.draft.version + 1 }
            const next = { ...state, drafts: [saved] }
            setState(next)
            return Promise.resolve({
                state: next,
                draftSaved: saved,
                connections: { remote: false, notion: false, protectedStorage: false }
            })
        }
        return Promise.resolve({ state, connections: { remote: false, notion: false, protectedStorage: false } })
    }
    return (
        <ToastStackProvider>
            <main
                className="writing-workspace"
                dir={params.get('rtl') === '1' ? 'rtl' : 'ltr'}
                style={{
                    width: '100%',
                    maxWidth: Number(params.get('width') ?? 500),
                    marginInline: 'auto',
                    flex: 'none',
                    minHeight: 0,
                    height: 'calc(100dvh - 90px)'
                }}
            >
                <WorkspaceDraft
                    state={state}
                    week={week}
                    notionConnected={false}
                    run={run}
                    publishTarget={null}
                    onReady={noop}
                    onSettings={noop}
                />
            </main>
            <div
                style={{
                    position: 'fixed',
                    bottom: 12,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    maxWidth: '95vw',
                    zIndex: 100
                }}
            >
                <SegmentedControl
                    label="Stress dataset"
                    size="sm"
                    options={options}
                    value={mode}
                    onValueChange={(value) => {
                        setMode(value)
                        params.set('data', value)
                        location.search = params.toString()
                    }}
                />
            </div>
        </ToastStackProvider>
    )
}
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Fixture />)
