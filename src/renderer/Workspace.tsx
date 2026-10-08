import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, RefreshCw, Settings2 } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { Button } from './components/arc/button/button'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import { journalWeek, offsetDay } from './hub-model'
import { shiftWeek, weekOf } from '../shared/model'
import type { State } from '../shared/model'
import { Switch } from './components/arc/switch/switch'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs'
import { motionTokens } from './components/arc/lib/motion-tokens'
import './workspace.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)
const variants = ['review', 'compose', 'focus'] as const
type Variant = (typeof variants)[number]
const getVariant = (): Variant =>
    variants.find((item) => item === new URLSearchParams(location.search).get('variant')) ?? 'review'
const dateValue = (day: string) => new Date(`${day}T12:00:00`)
const dateKey = (day: Date) =>
    `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`

interface Props {
    includedCount: number
    state: State
    week: string
    onWeek: (week: string) => void
    onBack: () => void
    onSettings: () => void
    onRefresh: () => Promise<void>
    busy: boolean
    error: string
    onDismissError: () => void
    panes: { activity: ReactNode; details: ReactNode; draft: ReactNode }
    sample: boolean
    onSample: (sample: boolean) => Promise<void>
    switching: boolean
    overlays: ReactNode
}

export function Workspace({
    includedCount,
    state,
    week,
    onWeek,
    onBack,
    onSettings,
    onRefresh,
    busy,
    error,
    onDismissError,
    panes,
    sample,
    onSample,
    switching,
    overlays
}: Props) {
    const [variant, setVariant] = useState(getVariant)
    const [stage, setStage] = useState('choose')
    const root = useRef<HTMLElement>(null)
    const currentWeek = weekOf(new Date(), state.settings)
    const choose = (value: Variant) => {
        const url = new URL(location.href)
        url.searchParams.set('variant', value)
        history.pushState({}, '', url)
        setVariant(getVariant())
    }
    useEffect(() => {
        const pop = () => setVariant(getVariant())
        const key = (event: KeyboardEvent) => {
            if (
                event.ctrlKey ||
                event.altKey ||
                event.metaKey ||
                (event.target instanceof HTMLElement &&
                    event.target.closest('input,textarea,[contenteditable],[role=dialog],[role=combobox]'))
            )
                return
            const index = Number(event.key) - 1
            if (index >= 0 && index < variants.length) choose(variants[index])
        }
        window.addEventListener('popstate', pop)
        window.addEventListener('keydown', key)
        return () => {
            window.removeEventListener('popstate', pop)
            window.removeEventListener('keydown', key)
        }
    }, [])
    useGSAP(
        () => {
            const media = gsap.matchMedia()
            media.add('(prefers-reduced-motion: no-preference)', () => {
                gsap.fromTo(
                    '.workspace-heading',
                    { opacity: 0, y: 8 },
                    { opacity: 1, y: 0, duration: motionTokens.duration.considered, clearProps: 'all' }
                )
            })
            media.add('(min-width: 801px) and (prefers-reduced-motion: no-preference)', () => {
                if (variant === 'compose')
                    ScrollTrigger.create({
                        trigger: '.workspace-flowbar',
                        endTrigger: '.workspace-grid',
                        start: 'top 16px',
                        end: 'bottom 120px',
                        pin: true,
                        pinSpacing: false
                    })
            })
            return () => media.revert()
        },
        { scope: root, dependencies: [variant], revertOnUpdate: true }
    )

    return (
        <main data-stage={stage} ref={root} className={`journal-workspace workspace-${variant}`}>
            <a className="workspace-skip" href="#workspace-writing" onClick={() => setStage('write')}>
                Skip to journal
            </a>
            <nav className="workspace-nav" aria-label="Journal navigation">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft size={15} />
                    Your week
                </Button>
                <div className="workspace-week">
                    <DateRangePicker
                        label="Journal week"
                        value={{ start: dateValue(week), end: dateValue(offsetDay(week, 6)) }}
                        fixedRangeDays={7}
                        weekStartsOn={state.settings.weekStart}
                        normalizeStart={(date) => dateValue(journalWeek(dateKey(date), state.settings.weekStart))}
                        onChange={(range) => onWeek(dateKey(range.start))}
                        presets={[0, 1, 2, 3].map((offset) => ({
                            label: offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `${offset} weeks ago`,
                            range: () => ({
                                start: dateValue(shiftWeek(currentWeek, -offset)),
                                end: dateValue(offsetDay(shiftWeek(currentWeek, -offset), 6))
                            })
                        }))}
                    />
                </div>
                <div className="workspace-utilities">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Refresh activity"
                        title="Refresh activity"
                        loading={busy}
                        onClick={onRefresh}
                    >
                        <RefreshCw size={15} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={sample}
                        aria-label="Open settings"
                        title="Settings"
                        onClick={onSettings}
                    >
                        <Settings2 size={16} />
                    </Button>
                </div>
            </nav>
            <header className="workspace-heading">
                <div>
                    <h1>Your journal</h1>
                    <p>Choose the work to include, then write the story behind it.</p>
                </div>
                <span className="workspace-private">{sample ? 'Sample journal' : 'Your private journal'}</span>
            </header>
            {(error || state.refreshError) && (
                <div className="workspace-error" role="alert">
                    <p>{error || state.refreshError}</p>
                    <Button variant="secondary" size="sm" onClick={onDismissError}>
                        Dismiss
                    </Button>
                </div>
            )}
            <Tabs
                className="workspace-flow"
                value={stage}
                onValueChange={(value) => {
                    setStage(value)
                    requestAnimationFrame(() => {
                        document
                            .querySelector<HTMLElement>(value === 'write' ? '.workspace-writing .tiptap' : '#search')
                            ?.focus({ preventScroll: true })
                    })
                }}
            >
                <div className="workspace-flowbar">
                    <TabsList aria-label="Journal workflow">
                        <TabsTrigger value="choose">Choose work</TabsTrigger>
                        <TabsTrigger value="write">Write journal</TabsTrigger>
                    </TabsList>
                    <span className="workspace-selection-count">{includedCount} included in this draft</span>
                </div>
                <div className="workspace workspace-grid">
                    <TabsContent forceMount value="choose" className="workspace-work">
                        {panes.activity}
                    </TabsContent>
                    <TabsContent forceMount value="write" id="workspace-writing" className="workspace-writing">
                        {panes.draft}
                    </TabsContent>
                    <div className="workspace-inspector">{panes.details}</div>
                </div>
            </Tabs>
            <footer className="workspace-footnote">
                <span>
                    {sample ? 'Sample edits stay separate from your journal' : 'Your draft is saved on this device'}
                </span>
            </footer>
            <nav className="variant-picker" aria-label="Workspace variants">
                <SegmentedControl
                    label="Workspace layout"
                    value={variant}
                    onValueChange={(value) => choose(value as Variant)}
                    options={variants.map((value) => ({
                        value,
                        label: value.charAt(0).toUpperCase() + value.slice(1)
                    }))}
                />
                <Switch
                    className="variant-data"
                    label="Sample data"
                    checked={sample}
                    disabled={switching || (sample && !window.journal)}
                    onCheckedChange={(value) => {
                        void onSample(value)
                    }}
                    title={
                        sample && !window.journal
                            ? 'Real data requires the desktop app'
                            : 'Switch between sample and real data'
                    }
                />
            </nav>
            {overlays}
        </main>
    )
}
