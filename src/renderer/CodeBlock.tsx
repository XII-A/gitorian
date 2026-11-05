import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { loadCodeHighlighting, type CodeRun } from './code-highlighting'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export function CodeBlock({ source, language }: { source: string; language?: string }) {
    const [highlighted, setHighlighted] = useState<{ source: string; language?: string; runs: CodeRun[] }>()
    useEffect(() => {
        let current = true
        void loadCodeHighlighting().then((runtime) => {
            if (current)
                setHighlighted({
                    source,
                    language,
                    runs: runtime.status === 'ready' ? runtime.highlight(source, language) : []
                })
        })
        return () => {
            current = false
        }
    }, [source, language])
    const runs = highlighted?.source === source && highlighted.language === language ? highlighted.runs : []
    const diff = language === 'diff'
    let offset = 0,
        runIndex = 0
    return (
        <ScrollArea
            className={`hub-detail-code-scroll${diff ? ' hub-detail-diff-scroll' : ''}`}
            orientation="both"
            maxHeight={360}
            label={diff ? 'Diff code block' : 'Code block'}
            fade={0}
        >
            <pre className={diff ? 'hub-detail-diff' : undefined}>
                <code className={language ? `language-${language}` : undefined}>
                    {(source.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((part, index) => {
                        const start = offset,
                            end = start + part.length - (diff && part.endsWith('\n') ? 1 : 0)
                        offset += part.length
                        const children: ReactNode[] = []
                        let cursor = start
                        while (runIndex < runs.length && runs[runIndex].to <= start) runIndex++
                        for (let i = runIndex; i < runs.length && runs[i].from < end; i++) {
                            const run = runs[i],
                                from = Math.max(start, run.from),
                                to = Math.min(end, run.to)
                            if (from > cursor) children.push(source.slice(cursor, from))
                            children.push(
                                <span key={from} data-code-token="" style={run.style}>
                                    {source.slice(from, to)}
                                </span>
                            )
                            cursor = to
                        }
                        if (cursor < end) children.push(source.slice(cursor, end))
                        const change =
                            part.startsWith('+') && !part.startsWith('+++ ')
                                ? 'added'
                                : part.startsWith('-') && !part.startsWith('--- ')
                                  ? 'removed'
                                  : 'context'
                        return diff ? (
                            <Fragment key={index}>
                                <span className="hub-detail-diff-line" data-diff-line={change}>
                                    {children}
                                </span>
                                {part.endsWith('\n') ? '\n' : null}
                            </Fragment>
                        ) : (
                            <Fragment key={index}>{children}</Fragment>
                        )
                    })}
                </code>
            </pre>
        </ScrollArea>
    )
}
