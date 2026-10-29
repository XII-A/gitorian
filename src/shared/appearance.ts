import { z } from 'zod'

import { themeIds } from './themes'
export const appearanceSchema = z.object({ mode: z.enum(['light', 'dark', 'system']), theme: z.enum(themeIds) })
export type Appearance = z.infer<typeof appearanceSchema>
export const defaultAppearance: Appearance = { mode: 'dark', theme: 'neutral' }
export function normalizeAppearance(value: unknown): Appearance {
    const parsed = appearanceSchema.safeParse(value)
    return parsed.success ? parsed.data : defaultAppearance
}
export function resolveAppearance(value: Appearance, dark: boolean): 'light' | 'dark' {
    return value.mode === 'system' ? (dark ? 'dark' : 'light') : value.mode
}
