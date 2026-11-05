import { remarkEmoji } from './provider-emoji'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Activity, Repository } from '../shared/model'
import { markdownUrl } from './activity-details'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { MermaidBlock } from './MermaidBlock'
import { CodeBlock } from './CodeBlock'

const DescriptionPre: NonNullable<Components['pre']> = ({ node, children }) => {
    const code = node?.children[0]
    const text = code?.type === 'element' ? code.children[0] : undefined
    if (
        code?.type === 'element' &&
        code.tagName === 'code' &&
        Array.isArray(code.properties.className) &&
        code.properties.className.includes('language-mermaid') &&
        (text?.type === 'text' || !text)
    )
        return <MermaidBlock source={text?.type === 'text' ? text.value : ''} />
    return code?.type === 'element' && code.tagName === 'code' && (text?.type === 'text' || !text) ? (
        <CodeBlock
            source={text?.type === 'text' ? text.value : ''}
            language={
                Array.isArray(code.properties.className)
                    ? code.properties.className
                          .find((value) => typeof value === 'string' && value.startsWith('language-'))
                          ?.toString()
                          .slice(9)
                    : undefined
            }
        />
    ) : (
        <ScrollArea className="hub-detail-code-scroll" orientation="both" maxHeight={360} label="Code block" fade={0}>
            <pre>{children}</pre>
        </ScrollArea>
    )
}

export function ActivityDescription({ activity, repository }: { activity: Activity; repository?: Repository }) {
    if (activity.kind === 'commit') return <p className="hub-detail-commit-message">{activity.description}</p>
    return (
        <div className="hub-detail-markdown">
            <Markdown
                key={activity.id}
                remarkPlugins={[remarkGfm, remarkEmoji]}
                skipHtml
                urlTransform={(url, key) => {
                    const resolved = markdownUrl(url, activity, repository)
                    if (key !== 'src' || !resolved) return resolved
                    const imageUrl = new URL(resolved)
                    if (imageUrl.hostname === 'github.com' && imageUrl.pathname.includes('/blob/'))
                        imageUrl.searchParams.set('raw', 'true')
                    if (imageUrl.hostname === 'gitlab.com')
                        imageUrl.pathname = imageUrl.pathname.replace('/-/blob/', '/-/raw/')
                    return imageUrl.href
                }}
                components={{
                    pre: DescriptionPre,
                    a: ({ href, children }) =>
                        href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        ) : (
                            <span>{children}</span>
                        ),
                    img: ({ src, alt, title }) =>
                        src ? (
                            <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
                        ) : (
                            <span>{alt}</span>
                        ),
                    table: ({ children }) => (
                        <div className="hub-detail-table-scroll">
                            <table>{children}</table>
                        </div>
                    ),
                    h1: ({ children }) => <h4>{children}</h4>,
                    h2: ({ children }) => <h4>{children}</h4>,
                    h3: ({ children }) => <h4>{children}</h4>,
                    h4: ({ children }) => <h5>{children}</h5>,
                    h5: ({ children }) => <h6>{children}</h6>
                }}
            >
                {activity.description}
            </Markdown>
        </div>
    )
}
