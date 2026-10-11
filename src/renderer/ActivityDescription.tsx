import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Activity, Repository } from '../shared/model'
import { markdownUrl } from './activity-details'

export function ActivityDescription({ activity, repository }: { activity: Activity; repository?: Repository }) {
    if (activity.kind === 'commit') return <p className="hub-detail-commit-message">{activity.description}</p>
    return (
        <div className="hub-detail-markdown">
            <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                urlTransform={(url, key) => {
                    const resolved = markdownUrl(url, activity, repository)
                    if (key !== 'src' || !resolved) return resolved
                    const imageUrl = new URL(resolved)
                    if (imageUrl.hostname === 'github.com' && imageUrl.pathname.includes('/blob/'))
                        imageUrl.searchParams.set('raw', 'true')
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
