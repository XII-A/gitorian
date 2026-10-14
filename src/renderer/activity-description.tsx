import { Fragment } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Activity, Repository } from '../shared/model'
import { markdownUrl } from './activity-details'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

const DiffBlock = ({ value }: { value: string }) => {
    const lines = value.match(/[^\n]*\n|[^\n]+$/gu) ?? []
    return (
        <ScrollArea
            className="hub-detail-code-scroll hub-detail-diff-scroll"
            orientation="both"
            maxHeight={360}
            label="Diff code block"
            fade={0}
        >
            <pre className="hub-detail-diff">
                <code className="language-diff">
                    {lines.map((part, index) => {
                        const line = part.endsWith('\n') ? part.slice(0, -1) : part
                        const change = (() => {
                            if (line.startsWith('+') && !line.startsWith('+++ ')) {
                                return 'added'
                            }
                            if (line.startsWith('-') && !line.startsWith('--- ')) {
                                return 'removed'
                            }
                            return 'context'
                        })()
                        return (
                            <Fragment key={index}>
                                <span className="hub-detail-diff-line" data-diff-line={change}>
                                    {line}
                                </span>
                                {part.endsWith('\n') ? '\n' : null}
                            </Fragment>
                        )
                    })}
                </code>
            </pre>
        </ScrollArea>
    )
}

export const ActivityDescription = ({ activity, repository }: { activity: Activity; repository?: Repository }) => {
    if (activity.kind === 'commit') {
        return <p className="hub-detail-commit-message">{activity.description}</p>
    }
    return (
        <div className="hub-detail-markdown">
            <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                urlTransform={(url, key) => {
                    const resolved = markdownUrl(url, activity, repository)
                    if (key !== 'src' || !resolved) {
                        return resolved
                    }
                    const imageUrl = new URL(resolved)
                    if (imageUrl.hostname === 'github.com' && imageUrl.pathname.includes('/blob/')) {
                        imageUrl.searchParams.set('raw', 'true')
                    }
                    return imageUrl.href
                }}
                components={{
                    a: ({ href, children }) =>
                        href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        ) : (
                            <span>{children}</span>
                        ),
                    h1: ({ children }) => <h4>{children}</h4>,
                    h2: ({ children }) => <h4>{children}</h4>,
                    h3: ({ children }) => <h4>{children}</h4>,
                    h4: ({ children }) => <h5>{children}</h5>,
                    h5: ({ children }) => <h6>{children}</h6>,
                    img: ({ src, alt, title }) =>
                        src ? (
                            <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
                        ) : (
                            <span>{alt}</span>
                        ),
                    pre: ({ node, children }) => {
                        const [code] = node?.children ?? []
                        const text = code?.type === 'element' ? code.children[0] : undefined
                        return code?.type === 'element' &&
                            code.tagName === 'code' &&
                            Array.isArray(code.properties.className) &&
                            code.properties.className.includes('language-diff') &&
                            text?.type === 'text' ? (
                            <DiffBlock value={text.value} />
                        ) : (
                            <ScrollArea
                                className="hub-detail-code-scroll"
                                orientation="both"
                                maxHeight={360}
                                label="Code block"
                                fade={0}
                            >
                                <pre>{children}</pre>
                            </ScrollArea>
                        )
                    },
                    table: ({ children }) => (
                        <div className="hub-detail-table-scroll">
                            <table>{children}</table>
                        </div>
                    )
                }}
            >
                {activity.description}
            </Markdown>
        </div>
    )
}
