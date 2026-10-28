import { gemoji } from 'gemoji'

export const emojiCategories = [
    { id: 'all', label: 'All emoji' },
    { id: 'recent', label: 'Recent' },
    { id: 'people', label: 'People' },
    { id: 'nature', label: 'Nature' },
    { id: 'food', label: 'Food and drink' },
    { id: 'activity', label: 'Activities' },
    { id: 'travel', label: 'Travel' },
    { id: 'objects', label: 'Objects' },
    { id: 'symbols', label: 'Symbols' },
    { id: 'flags', label: 'Flags' }
] as const
export type EmojiCategory = (typeof emojiCategories)[number]['id']
export interface EmojiUse {
    emoji: string
    count: number
    last: number
}
const categoryMap: Record<string, EmojiCategory> = {
    'Smileys & Emotion': 'people',
    'People & Body': 'people',
    'Animals & Nature': 'nature',
    'Food & Drink': 'food',
    Activities: 'activity',
    'Travel & Places': 'travel',
    Objects: 'objects',
    Symbols: 'symbols',
    Flags: 'flags'
}
const normalize = (text: string) => text.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ')
const catalog = gemoji.map((item) => ({
    ...item,
    section: categoryMap[item.category] ?? 'objects',
    search: normalize([item.description, ...item.names, ...item.tags].join(' '))
}))
const byEmoji = new Map(catalog.map((item) => [item.emoji, item]))
export type EmojiResult = (typeof catalog)[number]
export const emojiHistoryKey = 'gitorian:emoji-history:v1'
export function readEmojiHistory(): EmojiUse[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(emojiHistoryKey) ?? '[]')
        if (!Array.isArray(parsed)) return []
        return parsed
            .filter(
                (item): item is EmojiUse =>
                    !!item &&
                    typeof item.emoji === 'string' &&
                    byEmoji.has(item.emoji) &&
                    Number.isSafeInteger(item.count) &&
                    item.count > 0 &&
                    Number.isFinite(item.last)
            )
            .slice(0, 48)
    } catch {
        return []
    }
}
export function recordEmoji(history: EmojiUse[], emoji: string): EmojiUse[] {
    const next = [
        ...history.filter((item) => item.emoji !== emoji),
        { emoji, count: (history.find((item) => item.emoji === emoji)?.count ?? 0) + 1, last: Date.now() }
    ]
        .sort((a, b) => b.count - a.count || b.last - a.last)
        .slice(0, 48)
    try {
        localStorage.setItem(emojiHistoryKey, JSON.stringify(next))
    } catch {
        /* Insertion remains available when storage is full or disabled. */
    }
    return next
}
export function findEmoji(query: string, category: EmojiCategory = 'all', history: EmojiUse[] = []): EmojiResult[] {
    const search = normalize(query)
    const recent = history
        .map((use) => byEmoji.get(use.emoji))
        .filter((item): item is EmojiResult => !!item && (!search || item.search.includes(search)))
        .map((item) => ({ ...item, section: 'recent' as const }))
    if (category === 'recent') return recent
    const results = catalog.filter(
        (item) => (category === 'all' || item.section === category) && (!search || item.search.includes(search))
    )
    if (category !== 'all' || search) return results
    const seen = new Set(recent.map((item) => item.emoji))
    return [...recent, ...results.filter((item) => !seen.has(item.emoji))]
}
