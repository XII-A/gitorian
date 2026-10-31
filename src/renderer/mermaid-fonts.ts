import normal from '@fontsource-variable/geist/wght.css?raw'
import italic from '@fontsource-variable/geist/wght-italic.css?raw'

import face0 from '@fontsource-variable/geist/files/geist-cyrillic-ext-wght-italic.woff2?inline'
import face1 from '@fontsource-variable/geist/files/geist-cyrillic-ext-wght-normal.woff2?inline'
import face2 from '@fontsource-variable/geist/files/geist-cyrillic-wght-italic.woff2?inline'
import face3 from '@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?inline'
import face4 from '@fontsource-variable/geist/files/geist-latin-ext-wght-italic.woff2?inline'
import face5 from '@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?inline'
import face6 from '@fontsource-variable/geist/files/geist-latin-wght-italic.woff2?inline'
import face7 from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline'
import face8 from '@fontsource-variable/geist/files/geist-vietnamese-wght-italic.woff2?inline'
import face9 from '@fontsource-variable/geist/files/geist-vietnamese-wght-normal.woff2?inline'

// Only our bundled sans faces may enter an inert diagram image. No authored URLs.
const assets: Record<string, string> = {
    'geist-cyrillic-ext-wght-italic.woff2': face0,
    'geist-cyrillic-ext-wght-normal.woff2': face1,
    'geist-cyrillic-wght-italic.woff2': face2,
    'geist-cyrillic-wght-normal.woff2': face3,
    'geist-latin-ext-wght-italic.woff2': face4,
    'geist-latin-ext-wght-normal.woff2': face5,
    'geist-latin-wght-italic.woff2': face6,
    'geist-latin-wght-normal.woff2': face7,
    'geist-vietnamese-wght-italic.woff2': face8,
    'geist-vietnamese-wght-normal.woff2': face9
}
const svgStyle = (normal + italic).replace(/url\(\.\/files\/([^)]*)\)/g, (_, file: string) => {
    const data = assets[file]
    if (!data?.startsWith('data:')) throw new Error('Missing bundled diagram font')
    return `url(${data})`
})

export async function diagramTypography(text: string) {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim()
    await Promise.all(
        ['normal', 'italic'].flatMap((style) =>
            [400, 500, 700].map((weight) => document.fonts.load(`${style} ${weight} 14px ${family}`, text))
        )
    )
    return { family, svgStyle }
}
