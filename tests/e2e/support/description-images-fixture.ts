import { state } from './mermaid-fixture'

state.repositories[0].remote = 'https://github.com/example/project'
state.activities = [
    {
        ...state.activities[0],
        id: 'description-images',
        title: 'Preview HTML images in PR descriptions',
        url: 'https://github.com/example/project/pull/42',
        base: 'main',
        description: [
            '## Image previews',
            'HTML images use the same preview as Markdown attachments.',
            '<img src="docs/preview.png" alt="HTML attachment" title="Preview" width="120" height="120" onerror="window.imageHandlerRan = true">',
            '![Markdown attachment](https://example.com/preview.png)',
            'The original HTML stays literal inside code: `<img src="docs/preview.png">`.'
        ].join('\n\n')
    }
]

export { state }
