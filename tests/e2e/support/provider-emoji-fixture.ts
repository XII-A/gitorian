import { state } from './mermaid-fixture'
state.activities = [
    {
        ...state.activities[0],
        id: 'fixture:pr:42',
        title: ':rocket: Ship emoji support :tada:',
        description:
            '## Ready to launch :rocket:\n\nPull request descriptions now display **:sparkles: emoji shortcodes** alongside native emoji \u{1f389}.\n\n- :white_check_mark: GitHub and GitLab descriptions\n- :+1: Titles and formatted text\n- :heart: Existing Unicode emoji\n\nCode stays exact: `:rocket:`\n\n```js\nconst shortcode = ":tada:"\n```\n\nUnknown shortcodes stay readable: :unknown_emoji:.'
    }
]
export { state }
