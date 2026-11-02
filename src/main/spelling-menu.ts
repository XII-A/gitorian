import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { SpellingContext } from '../shared/model'

export function installSpellingMenu() {
    const contexts = new Map<number, SpellingContext>()
    const request = z.object({
        id: z.number(),
        action: z.enum(['replace', 'learn', 'toggle']),
        word: z.string().optional()
    })
    ipcMain.handle('journal:spelling-action', (event, input: unknown) => {
        if (event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown desktop frame')
        const command = request.parse(input)
        const context = contexts.get(event.sender.id)
        if (!context || context.id !== command.id) return
        contexts.delete(event.sender.id)
        if (command.action === 'replace' && command.word && context.suggestions.includes(command.word))
            event.sender.replaceMisspelling(command.word)
        if (command.action === 'learn' && context.word)
            event.sender.session.addWordToSpellCheckerDictionary(context.word)
        if (command.action === 'toggle' && context.editable)
            event.sender.session.setSpellCheckerEnabled(!context.enabled)
    })
    let id = 0
    return (window: BrowserWindow) => {
        const contents = window.webContents
        contents.on('context-menu', (_event, params) => {
            const context: SpellingContext = {
                id: ++id,
                x: params.x,
                y: params.y,
                word: params.isEditable ? params.misspelledWord : '',
                suggestions: params.isEditable ? params.dictionarySuggestions : [],
                editable: params.isEditable,
                enabled: contents.session.isSpellCheckerEnabled()
            }
            contexts.set(contents.id, context)
            contents.send('journal:spelling-context', context)
        })
        contents.on('destroyed', () => contexts.delete(contents.id))
    }
}
