// Provider spellings: https://developers.notion.com/reference/block#code
export const codeLanguages = [
    'abap',
    'arduino',
    'bash',
    'basic',
    'c',
    'clojure',
    'coffeescript',
    'c++',
    'c#',
    'css',
    'dart',
    'diff',
    'docker',
    'elixir',
    'elm',
    'erlang',
    'flow',
    'fortran',
    'f#',
    'gherkin',
    'glsl',
    'go',
    'graphql',
    'groovy',
    'haskell',
    'html',
    'java',
    'javascript',
    'json',
    'julia',
    'kotlin',
    'latex',
    'less',
    'lisp',
    'livescript',
    'lua',
    'makefile',
    'markdown',
    'markup',
    'matlab',
    'mermaid',
    'nix',
    'objective-c',
    'ocaml',
    'pascal',
    'perl',
    'php',
    'plain text',
    'powershell',
    'prolog',
    'protobuf',
    'python',
    'r',
    'reason',
    'ruby',
    'rust',
    'sass',
    'scala',
    'scheme',
    'scss',
    'shell',
    'sql',
    'swift',
    'typescript',
    'vb.net',
    'verilog',
    'vhdl',
    'visual basic',
    'webassembly',
    'xml',
    'yaml',
    'java/c/c++/c#'
]

const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shell',
    yml: 'yaml',
    md: 'markdown',
    cs: 'c#',
    cpp: 'c++',
    dockerfile: 'docker',
    text: 'plain text',
    txt: 'plain text',
    plaintext: 'plain text'
}

/** Preserve unfamiliar fence languages locally; only the provider adapter falls back. */
export function codeLanguage(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null
    const language = value.trim().toLowerCase()
    const canonical = aliases[language] ?? language
    return canonical === 'plain text' ? null : canonical
}

export function notionCodeLanguage(value: unknown): string {
    const language = codeLanguage(value)
    return language && codeLanguages.includes(language) ? language : 'plain text'
}

export function codeLanguageLabel(value: string): string {
    return (
        (
            {
                javascript: 'JavaScript',
                typescript: 'TypeScript',
                json: 'JSON',
                html: 'HTML',
                css: 'CSS',
                sql: 'SQL',
                xml: 'XML',
                yaml: 'YAML',
                php: 'PHP',
                graphql: 'GraphQL',
                powershell: 'PowerShell',
                'plain text': 'Plain text'
            } as Record<string, string>
        )[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
    )
}
