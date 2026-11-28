import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Resizable viewport journeys start from a windowed disposable profile.
export function seedWindowedProfile(profile) {
    mkdirSync(profile, { recursive: true })
    writeFileSync(
        join(profile, 'window-state.json'),
        JSON.stringify({
            x: 0,
            y: 0,
            width: 1560,
            height: 1000,
            maximized: false
        })
    )
}
