import CodeBlock from '@tiptap/extension-code-block'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, useEditorState } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { codeLanguage, codeLanguageLabel, codeLanguages } from '../shared/code-languages'
import { Combobox } from './components/arc/combobox/combobox'
import { FloatingButtonGroup } from './components/arc/floating-button-group/floating-button-group'

/** The editor only installs this extension; controls never enter the document or exported HTML. */
export const JournalCodeBlock = CodeBlock.extend({
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
})

function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
    const editable = useEditorState({ editor, selector: ({ editor: current }) => current.isEditable })
    const [wrapped, setWrapped] = useState(false)
    const [copyStatus, setCopyStatus] = useState('')
    const language = codeLanguage(node.attrs.language) ?? 'plain text'
    const options = ['plain text', ...codeLanguages.filter((value) => value !== 'plain text')]
    if (!options.includes(language)) options.unshift(language)
    const copy = async () => {
        try {
            await window.journal.writeClipboardText(node.textContent)
            setCopyStatus('Code copied')
        } catch {
            setCopyStatus('Could not copy code. Try Copy code again.')
        }
    }
    return (
        <NodeViewWrapper className="journal-code-block" data-wrapped={wrapped || undefined}>
            <div className="journal-code-header" contentEditable={false}>
                <div className="journal-code-language">
                    {editable ? (
                        <Combobox
                            label="Code language"
                            hideLabel
                            variant="inline"
                            options={options.map((value) => ({ value, label: codeLanguageLabel(value) }))}
                            value={language}
                            onValueChange={(value) => updateAttributes({ language: codeLanguage(value) })}
                        />
                    ) : (
                        <span>{codeLanguageLabel(language)}</span>
                    )}
                </div>
                <div role="presentation" className="journal-code-tools" onMouseDown={(event) => event.preventDefault()}>
                    <FloatingButtonGroup
                        label="Code actions"
                        variant="floating"
                        size="sm"
                        iconOnly
                        items={[
                            {
                                id: 'copy',
                                label: 'Copy code',
                                icon: copyStatus === 'Code copied' ? <Check /> : <Copy />,
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
            </div>
            <pre spellCheck={false}>
                <NodeViewContent<'code'> as="code" style={{ whiteSpace: 'inherit' }} />
            </pre>
            <span className="journal-code-status" role="status" contentEditable={false}>
                {copyStatus}
            </span>
        </NodeViewWrapper>
    )
}
