import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

// Paper's SVG is the source of truth. Commit the outputs so packaging needs no design tools.
const resources = new URL('../resources/', import.meta.url)
const source = await readFile(new URL('icon.svg', resources))
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
/** @type {Map<number, Buffer>} */
const images = new Map()
for (const size of sizes) {
    images.set(size, await sharp(source).resize(size, size).png().toBuffer())
}
/** @param {number} size */
function imageFor(size) {
    const image = images.get(size)
    if (!image) throw new Error(`Missing ${size}px icon frame`)
    return image
}
await writeFile(new URL('icon.png', resources), imageFor(1024))

// ICO directories point to PNG frames; Windows chooses the appropriate resolution.
const windowsSizes = sizes.filter((size) => size <= 256)
const directory = Buffer.alloc(6 + windowsSizes.length * 16)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(windowsSizes.length, 4)
let offset = directory.length
for (const [index, size] of windowsSizes.entries()) {
    const frame = imageFor(size)
    const entry = 6 + index * 16
    directory[entry] = size === 256 ? 0 : size
    directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.length
}
await writeFile(new URL('icon.ico', resources), Buffer.concat([directory, ...windowsSizes.map(imageFor)]))

// Modern ICNS chunks contain PNGs, including Retina resolutions up to 1024px.
/** @type {[string, number][]} */
const macFormats = [
    ['icp4', 16],
    ['icp5', 32],
    ['icp6', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024]
]
const chunks = macFormats.map(([type, size]) => {
    const image = imageFor(size)
    const header = Buffer.alloc(8)
    header.write(type)
    header.writeUInt32BE(image.length + 8, 4)
    return Buffer.concat([header, image])
})
const header = Buffer.alloc(8)
header.write('icns')
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile(new URL('icon.icns', resources), Buffer.concat([header, ...chunks]))
console.info('Generated resources/icon.png, icon.ico, and icon.icns from icon.svg')
