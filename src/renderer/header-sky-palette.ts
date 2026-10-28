export type SkyPalette = readonly [string, string, string, string]

const palettes = {
    night: ['#11192e', '#383c62', '#747b99', '#29324d'],
    dawn: ['#394368', '#c39787', '#d6bdad', '#6c718b'],
    day: ['#295c86', '#91b2c6', '#d3dfdf', '#657f96'],
    dusk: ['#373b64', '#b17d73', '#c5a3a2', '#655b7c']
} as const satisfies Record<string, SkyPalette>

export type SkyPhase = keyof typeof palettes

// Local wall time intentionally follows the computer, not the journal's date grouping.
export function headerSkyPalette(now: Date, preview: SkyPhase | 'auto' = 'auto') {
    const hour = now.getHours() + now.getMinutes() / 60
    const phase =
        preview === 'auto'
            ? hour < 5 || hour >= 21
                ? 'night'
                : hour < 8
                  ? 'dawn'
                  : hour < 17
                    ? 'day'
                    : 'dusk'
            : preview
    return { phase, colors: palettes[phase] }
}
