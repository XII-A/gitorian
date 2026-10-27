import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { all, createLowlight } from 'lowlight'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, useEditorState } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { Check, Copy, WrapText, AlertCircle } from 'lucide-react'
import { codeLanguage, codeLanguageLabel } from '../shared/code-languages'
import { MorphSelect } from './components/arc/morph-select/morph-select'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

const lowlight = createLowlight(all)
lowlight.registerAlias({
    objectivec: 'objective-c',
    vbnet: 'vb.net',
    vbscript: 'visual basic',
    javascript: 'jsx',
    typescript: 'tsx'
})
const languages = Array.from(new Set([...lowlight.listLanguages(), 'html', 'jsx', 'tsx'].map(codeLanguage)))
    .filter((value): value is string => value !== null)
    .sort()

/** One code module owns its editable view and transient highlighting; neither controls nor colors serialize. */
export const JournalCodeBlock = CodeBlockLowlight.extend({
    addAttributes() {
        return {
            language: {
                default: null,
                parseHTML: (element) =>
                    element.getAttribute('data-language') ??
                    Array.from(element.firstElementChild?.classList ?? [])
                        .find((value) => value.startsWith('language-'))
                        ?.slice(9) ??
                    null,
                renderHTML: (attributes) => (attributes.language ? { 'data-language': attributes.language } : {})
            }
        }
    },
    addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView)
    }
}).configure({
    defaultLanguage: 'plaintext',
    lowlight: {
        ...lowlight,
        // Plain text and unfamiliar fences stay literal rather than guessing a language.
        highlightAuto: () => ({ children: [] })
    }
})

function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
    const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable })
    const [wrapped, setWrapped] = useState(false)
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
    const language = codeLanguage(node.attrs.language) ?? 'plain text'
    const options = ['plain text', ...languages]
    if (!options.includes(language)) options.unshift(language)
    useEffect(() => {
        if (copyStatus !== 'copied') return
        const timeout = setTimeout(() => setCopyStatus('idle'), 2000)
        return () => clearTimeout(timeout)
    }, [copyStatus])
    const copy = async () => {
        try {
            await window.journal.writeClipboardText(node.textContent)
            setCopyStatus('copied')
        } catch {
            setCopyStatus('error')
        }
    }
    return (
        <NodeViewWrapper className="journal-code-block" data-wrapped={wrapped || undefined}>
            <div
                role="presentation"
                className="journal-code-tools"
                contentEditable={false}
                onMouseDown={(event) => {
                    if ((event.target as HTMLElement).closest('[data-fbg-item]')) event.preventDefault()
                }}
            >
                <FloatingButtonGroup
                    label="Code actions"
                    variant="floating"
                    size="xs"
                    shadow={false}
                    iconOnly
                    startContent={
                        <MorphSelect
                            label="Code language"
                            className="journal-code-language"
                            hideLabel
                            variant="ghost"
                            size="xs"
                            portal
                            align="end"
                            panelWidth={256}
                            maxListHeight={264}
                            maxTriggerWidth={144}
                            animateTriggerWidth={false}
                            title={codeLanguageLabel(language)}
                            items={options.map((value) => ({ value, label: codeLanguageLabel(value) }))}
                            value={language}
                            disabled={!editable}
                            onValueChange={(value) => updateAttributes({ language: codeLanguage(value) })}
                        />
                    }
                    items={[
                        { type: 'separator', id: 'language-separator' },
                        {
                            id: 'copy',
                            label: copyStatus === 'error' ? 'Copy failed. Try again' : 'Copy code',
                            icon:
                                copyStatus === 'copied' ? (
                                    <Check />
                                ) : copyStatus === 'error' ? (
                                    <AlertCircle />
                                ) : (
                                    <Copy />
                                ),
                            onSelect: () => {
                                void copy()
                            }
                        },
                        {
                            id: 'wrap',
                            label: wrapped ? 'Unwrap lines' : 'Wrap lines',
                            icon: <WrapText />,
                            pressed: wrapped,
                            onSelect: () => setWrapped((value) => !value)
                        }
                    ]}
                />
            </div>
            <ScrollArea
                className="journal-code-scroll"
                viewportClassName="journal-code-viewport"
                orientation="horizontal"
                label="Code block"
                fade={0}
                wheelToHorizontal={false}
            >
                <pre spellCheck={false}>
                    <NodeViewContent<'code'> as="code" style={{ whiteSpace: 'inherit' }} />
                </pre>
            </ScrollArea>
            <span className="journal-code-status" role="status" contentEditable={false}>
                {copyStatus === 'copied'
                    ? 'Code copied'
                    : copyStatus === 'error'
                      ? 'Could not copy code. Try again.'
                      : ''}
            </span>
        </NodeViewWrapper>
    )
}
