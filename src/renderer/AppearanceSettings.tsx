import { useRef, useState, type CSSProperties } from 'react'
import { type Appearance } from '../shared/appearance'
import { themes, themePalette, type ThemeId, type ColorMode } from '../shared/themes'
import { useAppearance, selectAppearance } from './appearance'
import { RadioCards } from './components/arc/radio-cards/radio-cards'
import { Alert } from './components/arc/alert/alert'
import './appearance.css'

function WorkspacePreview({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
    return (
        <span className="appearance-preview" aria-hidden="true" style={themePalette(theme, mode) as CSSProperties}>
            <span className="appearance-preview-nav">
                <i />
                <i />
                <i />
            </span>
            <span className="appearance-preview-paper">
                <i />
                <i />
                <i />
                <b />
            </span>
            <span className="appearance-preview-inspector">
                <i />
                <i />
            </span>
        </span>
    )
}

export function AppearanceSettings() {
    const { preference, resolved, error } = useAppearance()
    const [animateChanges, setAnimateChanges] = useState(false)
    const pointer = useRef<HTMLElement | undefined>(undefined)
    const choose = (next: Partial<Appearance>) => {
        const origin = pointer.current
        pointer.current = undefined
        return selectAppearance(next, origin)
    }
    return (
        <section
            className="settings-section appearance-settings"
            aria-label="Appearance"
            data-input={animateChanges ? 'pointer' : 'keyboard'}
            onPointerDownCapture={(event) => {
                setAnimateChanges(true)
                pointer.current =
                    (event.target as HTMLElement).closest<HTMLElement>('[role="radio"]') ?? event.currentTarget
            }}
            onKeyDownCapture={() => {
                setAnimateChanges(false)
                pointer.current = undefined
            }}
        >
            <h3 id="appearance-scheme-label">Color scheme</h3>
            <RadioCards
                animateChanges={animateChanges}
                aria-labelledby="appearance-scheme-label"
                name="color-scheme"
                minColumnWidth={150}
                value={preference.mode}
                onValueChange={(mode) => {
                    void choose({ mode: mode as Appearance['mode'] })
                }}
                options={(['system', 'light', 'dark'] as const).map((mode) => ({
                    value: mode,
                    label: mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark',
                    preview:
                        mode === 'system' ? (
                            <span className="appearance-split-preview">
                                <WorkspacePreview theme={preference.theme} mode="light" />
                                <WorkspacePreview theme={preference.theme} mode="dark" />
                            </span>
                        ) : (
                            <WorkspacePreview theme={preference.theme} mode={mode} />
                        )
                }))}
            />
            <p className="settings-hint">System follows your device. Changes are saved immediately.</p>
            <h3 id="appearance-themes-label">Themes</h3>
            <RadioCards
                animateChanges={animateChanges}
                aria-labelledby="appearance-themes-label"
                name="workspace-theme"
                minColumnWidth={180}
                value={preference.theme}
                onValueChange={(theme) => {
                    void choose({ theme: theme as Appearance['theme'] })
                }}
                options={themes.map((theme) => ({
                    value: theme.id,
                    label: theme.name,
                    preview: (
                        <span
                            className="appearance-theme-colors"
                            aria-hidden="true"
                            style={themePalette(theme.id, resolved) as CSSProperties}
                        >
                            <span className="appearance-theme-orb" />
                        </span>
                    )
                }))}
            />
            {error && <Alert tone="danger" title={error} />}
        </section>
    )
}
