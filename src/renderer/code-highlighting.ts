import type { CSSProperties } from 'react'
import { codeLanguage } from '../shared/code-languages'
import { codeLexers } from './code-highlight-languages'
export { codeLanguageChoices } from './code-highlight-languages'

export const codeTheme = 'gitorian-code'
export const codeLimits = { source: 250_000, line: 10_000, patch: 2_000_000, inlineDiff: 1000 } as const
export interface CodeRun {
    from: number
    to: number
    style: CSSProperties
}
export type CodeHighlighting =
    | { status: 'ready'; highlight: (source: string, language: string | null | undefined) => CodeRun[] }
    | { status: 'unavailable' }

export function codeLexer(language: string | null | undefined): string | undefined {
    const name = codeLanguage(language)
    return name && Object.hasOwn(codeLexers, name) ? codeLexers[name] : undefined
}

let loading: Promise<CodeHighlighting> | undefined
/** One lazy runtime per window; callers can always show the original source. */
export function loadCodeHighlighting(): Promise<CodeHighlighting> {
    return (loading ??= initialize())
}

async function initialize(): Promise<CodeHighlighting> {
    try {
        const { createCSSVariablesTheme, registerCustomTheme, getSharedHighlighter } = await import('@pierre/diffs')
        registerCustomTheme(
            codeTheme,
            () =>
                Promise.resolve(
                    createCSSVariablesTheme({ name: codeTheme, variablePrefix: '--code-', fontStyle: false })
                ),
            'diffs'
        )
        const highlighter = await getSharedHighlighter({
            themes: [codeTheme],
            langs: [],
            preferredHighlighter: 'highlights'
        })
        return {
            status: 'ready',
            highlight(source, language) {
                const lang = codeLexer(language)
                if (!lang || source.length > codeLimits.source) return []
                try {
                    const { tokens } = highlighter.codeToTokens(source, {
                        lang,
                        theme: codeTheme,
                        tokenizeMaxLineLength: codeLimits.line
                    })
                    return tokens.flatMap((line) =>
                        line.flatMap((token) => {
                            const from = token.offset,
                                to = from + token.content.length
                            if (!token.content || source.slice(from, to) !== token.content) return []
                            return [
                                {
                                    from,
                                    to,
                                    style: {
                                        color: token.color,
                                        ...(token.fontStyle && token.fontStyle & 1 ? { fontStyle: 'italic' } : {}),
                                        ...(token.fontStyle && token.fontStyle & 2 ? { fontWeight: 500 } : {})
                                    }
                                }
                            ]
                        })
                    )
                } catch {
                    return []
                }
            }
        }
    } catch {
        return { status: 'unavailable' }
    }
}
