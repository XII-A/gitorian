import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request } from 'node:https'
import { Readable } from 'node:stream'
import { imageLimits } from '../shared/images'
import type { JournalImage } from '../shared/images'
import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom'

export class UnsupportedImageError extends Error {}

const svgElements = new Set(
    'svg g path rect circle ellipse line polyline polygon text tspan textPath defs marker mask clipPath linearGradient radialGradient stop pattern symbol use title desc style filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feMerge feMergeNode feFlood feDropShadow feComponentTransfer feFuncA feFuncR feFuncG feFuncB feMorphology feTurbulence feDisplacementMap'.split(
        ' '
    )
)
function validateSVG(bytes: Buffer): void {
    const source = bytes.toString('utf8')
    const invalid = () =>
        new UnsupportedImageError('Use a self-contained SVG without scripts, animations, or linked files.')
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw invalid()
    const document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(source, 'image/svg+xml')
    const root = document.documentElement
    if (!root || root.localName !== 'svg') throw invalid()
    const elements = Array.from(document.getElementsByTagName('*'))
    if (elements.length > 20_000) throw invalid()
    const localCSS = (value: string) => {
        if (/[@\\]|\/\*|</.test(value)) throw invalid()
        for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi))
            if (!/^['"]?#[\w:.-]+['"]?$/.test(match[1].trim())) throw invalid()
    }
    for (const element of elements) {
        if (!svgElements.has(element.localName ?? '') || element.namespaceURI !== 'http://www.w3.org/2000/svg')
            throw invalid()
        for (const attribute of Array.from(element.attributes)) {
            if (/^on/i.test(attribute.localName ?? '') || attribute.name === 'xml:base') throw invalid()
            if (attribute.localName === 'href' && !/^#[\w:.-]+$/.test(attribute.value)) throw invalid()
            localCSS(attribute.value)
        }
        if (element.localName === 'style') localCSS(element.textContent ?? '')
    }
}

export async function validateImage(input: Uint8Array): Promise<JournalImage> {
    if (!input.byteLength || input.byteLength > imageLimits.bytes)
        throw new UnsupportedImageError('Choose an image smaller than 5 MB.')
    const bytes = Buffer.from(input)
    try {
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        if (!png && !jpeg && !webp) validateSVG(bytes)
        if (png) {
            for (let offset = 8; offset + 12 <= bytes.length;) {
                if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new Error('Animated PNG')
                offset += 12 + bytes.readUInt32BE(offset)
            }
        }
        const image = sharp(bytes, { limitInputPixels: imageLimits.pixels, failOn: 'warning' })
        const metadata = await image.metadata()
        const mime = (
            { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' } as Record<
                string,
                JournalImage['mime']
            >
        )[metadata.format ?? '']
        if (!mime || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
            throw new Error('Unsupported image')
        // Decode the full image, rather than accepting a valid header with corrupt pixels.
        await image.stats()
        return {
            id: createHash('sha256').update(bytes).digest('hex'),
            mime,
            width: metadata.width,
            height: metadata.height,
            bytes
        }
    } catch (error) {
        if (error instanceof UnsupportedImageError) throw error
        throw new UnsupportedImageError('Use a valid PNG, JPEG, WebP, or self-contained SVG under 40 million pixels.')
    }
}

function publicAddress(address: string): boolean {
    if (isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number)
        return !(
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || b === 0)) ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && (b === 18 || b === 19))
        )
    }
    // Only global unicast IPv6, excluding mapped IPv4 and documentation ranges.
    return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address)
}

/** File requests never receive Notion credentials. Validate every redirect as well. */
export async function downloadImage(url: string, fetcher?: typeof fetch): Promise<JournalImage> {
    const signal = AbortSignal.timeout(30_000)
    for (let redirects = 0; redirects <= 3; redirects++) {
        const target = new URL(url)
        if (
            target.protocol !== 'https:' ||
            target.username ||
            target.password ||
            (target.port && target.port !== '443')
        )
            throw new Error('The image address is not a public HTTPS address.')
        const addresses = await lookup(target.hostname.replace(/^\[|\]$/g, ''), { all: true })
        if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
            throw new Error('The image address is not public.')
        // Pin the checked DNS answers to the actual connection, including redirects.
        const response = fetcher
            ? await fetcher(target, { redirect: 'manual', signal, credentials: 'omit' })
            : await new Promise<Response>((resolve, reject) => {
                  const pending = request(
                      target,
                      {
                          signal,
                          lookup: (_hostname, options, callback) => {
                              if (options.all) callback(null, addresses)
                              else callback(null, addresses[0].address, addresses[0].family)
                          }
                      },
                      (incoming) => {
                          const headers = new Headers()
                          for (const [key, value] of Object.entries(incoming.headers))
                              if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
                          resolve(
                              new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
                                  status: incoming.statusCode ?? 502,
                                  headers
                              })
                          )
                      }
                  )
                  pending.on('error', reject)
                  pending.end()
              })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel()
            const location = response.headers.get('location')
            if (!location) throw new Error('The image redirect is incomplete.')
            url = new URL(location, target).href
            continue
        }
        if (!response.ok || !response.body)
            throw new Error('Could not retrieve the Notion image. Try refreshing again.')
        if (Number(response.headers.get('content-length') ?? 0) > imageLimits.bytes) {
            await response.body.cancel()
            throw new UnsupportedImageError('The Notion image is larger than 5 MB.')
        }
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                size += value.byteLength
                if (size > imageLimits.bytes) throw new UnsupportedImageError('The Notion image is larger than 5 MB.')
                chunks.push(value)
            }
        } finally {
            await reader.cancel()
        }
        return validateImage(Buffer.concat(chunks))
    }
    throw new Error('The image redirected too many times.')
}
