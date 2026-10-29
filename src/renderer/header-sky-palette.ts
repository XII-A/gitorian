import { themePalette, type ThemeId, type ColorMode } from '../shared/themes'
export type SkyPalette = readonly [string, string, string, string]

const palettes = {
    night: ['#11192e', '#383c62', '#747b99', '#29324d'],
    dawn: ['#394368', '#c39787', '#d6bdad', '#6c718b'],
    day: ['#295c86', '#91b2c6', '#d3dfdf', '#657f96'],
    dusk: ['#373b64', '#b17d73', '#c5a3a2', '#655b7c']
} as const satisfies Record<string, SkyPalette>

// Local wall time intentionally follows the computer, not the journal's date grouping.
export function headerSkyPalette(now: Date, theme: ThemeId = 'neutral', mode: ColorMode = 'dark') {
    const hour = now.getHours() + now.getMinutes() / 60
    const phase = hour < 5 || hour >= 21 ? 'night' : hour < 8 ? 'dawn' : hour < 17 ? 'day' : 'dusk'
    if (theme === 'neutral' && mode === 'dark') return { phase, colors: palettes[phase] }
    const palette = themePalette(theme, mode)
    const base = [
        palette['--background'],
        palette['--accent-strong'],
        palette['--surface-muted'],
        palette['--accent']
    ] as const
    const blend = (first: string, second: string, amount: number) =>
        '#' +
        [1, 3, 5]
            .map((index) => {
                const a = parseInt(first.slice(index, index + 2), 16),
                    b = parseInt(second.slice(index, index + 2), 16)
                return Math.round(a + (b - a) * amount)
                    .toString(16)
                    .padStart(2, '0')
            })
            .join('')
    // Light skies keep the same exposure across phases; clock color lends them a gentle cast.
    const skyColor = (index: number) =>
        mode === 'light'
            ? blend(
                  palette['--background'],
                  blend(base[index], palettes[phase][index], 0.15),
                  theme === 'neutral' ? 0.2 : 0.35
              )
            : blend(palettes[phase][index], base[index], 0.65)
    const colors: SkyPalette = [skyColor(0), skyColor(1), skyColor(2), skyColor(3)]
    return { phase, colors }
}
