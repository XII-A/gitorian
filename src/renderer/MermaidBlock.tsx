import { useEffect, useId, useState } from 'react'
import { Check, CircleAlert, Copy, Maximize2, Minimize2 } from 'lucide-react'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import type { FloatingButtonGroupItem } from './components/arc/floating-button-group/floating-button-group'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Skeleton } from './components/arc/skeleton/skeleton'
import './mermaid-block.css'

const views = [
    { value: 'diagram', label: 'Diagram' },
    { value: 'source', label: 'Source' }
]
// Mermaid has global configuration. Serialize initialization and rendering across blocks/windows' themes.
let renderQueue: Promise<unknown> = Promise.resolve()

function themeColor(token: string) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    context.fillRect(0, 0, 1, 1)
    return (
        '#' +
        Array.from(context.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('')
    )
}

async function renderDiagram(id: string, source: string) {
    if (!source.trim()) throw new Error('The diagram is empty. View the source to check its contents.')
    if (source.length > 50_000)
        throw new Error('This diagram is too large to preview. View or copy the source instead.')
    const { default: mermaid } = await import('mermaid')
    const { diagramTypography } = await import('./mermaid-fonts')
    const typography = await diagramTypography(source)
    const foreground = themeColor('--foreground')
    const surface = themeColor('--surface-muted')
    const border = themeColor('--border-strong')
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: 50_000,
        maxEdges: 500,
        htmlLabels: false,
        theme: 'base',
        look: 'classic',
        fontFamily: typography.family,
        secure: [
            'secure',
            'securityLevel',
            'startOnLoad',
            'suppressErrorRendering',
            'maxTextSize',
            'maxEdges',
            'htmlLabels',
            'theme',
            'look',
            'themeCSS',
            'themeVariables',
            'fontFamily'
        ],
        themeVariables: {
            darkMode: document.documentElement.dataset.theme === 'dark',
            background: surface,
            primaryColor: surface,
            primaryTextColor: foreground,
            primaryBorderColor: border,
            secondaryColor: surface,
            secondaryTextColor: foreground,
            secondaryBorderColor: border,
            tertiaryColor: surface,
            tertiaryTextColor: foreground,
            tertiaryBorderColor: border,
            lineColor: foreground,
            textColor: foreground,
            mainBkg: surface,
            nodeBorder: border,
            clusterBkg: surface,
            clusterBorder: border,
            edgeLabelBackground: surface,
            actorBkg: surface,
            actorBorder: border,
            actorTextColor: foreground,
            actorLineColor: border,
            signalColor: foreground,
            signalTextColor: foreground,
            labelBoxBkgColor: surface,
            labelTextColor: foreground,
            loopTextColor: foreground,
            noteBkgColor: surface,
            noteTextColor: foreground,
            noteBorderColor: border,
            fontSize: '14px'
        }
    })
    const container = document.createElement('div')
    container.className = 'activity-mermaid-render-host'
    container.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden'
    document.body.append(container)
    try {
        const { svg } = await mermaid.render(id, source, container)
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
        const root = document.documentElement
        const staticStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        staticStyle.textContent = `${typography.svgStyle}\n* { animation: none !important; transition: none !important; }`
        root.append(staticStyle)
        const dimensions = root
            .getAttribute('viewBox')
            ?.trim()
            .split(/[\s,]+/)
            .map(Number)
        if (dimensions?.length === 4 && dimensions[2] > 0 && dimensions[3] > 0) {
            root.setAttribute('width', String(dimensions[2]))
            root.setAttribute('height', String(dimensions[3]))
        }
        // SVG image context is inert: authored scripts, links and external resources cannot act on the app.
        const image = new Image()
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
        await image.decode()
        return image.src
    } finally {
        container.remove()
    }
}

export function MermaidBlock({ source }: { source: string }) {
    const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '')
    const [view, setView] = useState('diagram')
    const [actualSize, setActualSize] = useState(false)
    const [result, setResult] = useState<{ image?: string; error?: string }>({})
    const [copy, setCopy] = useState<'idle' | 'copied' | 'error'>('idle')
    const [appearance, setAppearance] = useState(0)
    useEffect(() => {
        const observer = new MutationObserver(() => setAppearance((value) => value + 1))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })
        return () => observer.disconnect()
    }, [])
    useEffect(() => {
        let cancelled = false
        setResult({})
        const task = renderQueue.then(async () => {
            if (cancelled) return
            try {
                const image = await renderDiagram(id, source)
                if (!cancelled) setResult({ image })
            } catch (error) {
                if (!cancelled)
                    setResult({
                        error:
                            error instanceof Error && (!source.trim() || source.length > 50_000)
                                ? error.message
                                : 'Could not render this diagram. View the source to read its definition or check the Mermaid syntax.'
                    })
            }
        })
        renderQueue = task.catch(() => undefined)
        return () => {
            cancelled = true
        }
    }, [source, id, appearance])
    useEffect(() => {
        if (copy === 'idle') return
        const timer = setTimeout(() => setCopy('idle'), 1900)
        return () => clearTimeout(timer)
    }, [copy])
    const copySource = async () => {
        try {
            await window.journal.writeClipboardText(source)
            setCopy('copied')
        } catch {
            setCopy('error')
        }
    }
    const actions: FloatingButtonGroupItem[] = []
    if (view === 'diagram' && result.image) {
        const SizeIcon = actualSize ? Minimize2 : Maximize2
        actions.push({
            id: 'size',
            label: actualSize ? 'Fit diagram' : 'Actual size',
            icon: <SizeIcon size={16} strokeWidth={1.75} />,
            pressed: actualSize,
            onSelect: () => setActualSize((value) => !value)
        })
    }
    const CopyIcon = copy === 'copied' ? Check : copy === 'error' ? CircleAlert : Copy
    actions.push({
        id: 'copy',
        label: copy === 'copied' ? 'Copied' : copy === 'error' ? 'Retry copy' : 'Copy source',
        icon: <CopyIcon size={16} strokeWidth={1.75} />,
        onSelect: () => {
            void copySource()
        }
    })
    return (
        <section className="activity-mermaid" aria-label="Mermaid diagram">
            <div className="activity-mermaid-toolbar">
                <SegmentedControl options={views} value={view} onValueChange={setView} label="Mermaid view" size="sm" />
                <FloatingButtonGroup
                    label="Diagram actions"
                    items={actions}
                    iconOnly
                    size="sm"
                    variant="floating"
                    shadow={false}
                    tooltipSide="bottom"
                />
            </div>
            <span className="sr-only" role="status">
                {copy === 'copied' ? 'Source copied' : copy === 'error' ? 'Copy failed. Try again.' : ''}
            </span>
            {view === 'source' ? (
                <ScrollArea orientation="both" maxHeight={360} label="Mermaid source" fade={0}>
                    <pre>
                        <code>{source}</code>
                    </pre>
                </ScrollArea>
            ) : result.error ? (
                <p className="activity-mermaid-error" role="status">
                    {result.error}
                </p>
            ) : result.image ? (
                <ScrollArea orientation="both" maxHeight={480} label="Diagram preview" fade={0}>
                    <div className="activity-mermaid-canvas" data-actual-size={actualSize}>
                        <img src={result.image} alt="Mermaid diagram. Use Source to read its text definition." />
                    </div>
                </ScrollArea>
            ) : (
                <Skeleton shape="block" label="Rendering diagram" className="activity-mermaid-loading" />
            )}
        </section>
    )
}
