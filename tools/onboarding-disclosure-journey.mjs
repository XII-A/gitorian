import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/** Focused real-renderer reproduction. No accounts, repositories or network setup. */
export async function onboardingDisclosureJourney({ window, output, js, wait }) {
    const pause = (ms) => new Promise((done) => setTimeout(done, ms))
    const traces = []
    const failures = []
    const setup = `document.querySelector('section[data-controlled]')`
    await wait(`!!document.querySelector('.hub-preview-heading p')`)
    window.setMinimumSize(320, 400)
    window.setContentSize(1280, 900)
    await pause(150)
    const capture = async (name, expression) => {
        await js(`(() => {
            const frames=[];const started=performance.now();window.__disclosure={frames};
            const sample=()=>{
                const p=document.querySelector('.hub-preview-heading p');
                const heading=document.querySelector('.hub-preview-heading h2');
                const preview=document.querySelector('.hub-activity-preview');
                const range=document.createRange();range.selectNodeContents(p);
                const pr=p.getBoundingClientRect(),hr=heading.getBoundingClientRect(),rr=range.getBoundingClientRect();
                frames.push({time:performance.now()-started,top:pr.top,heading:hr.top,relative:pr.top-hr.bottom,ink:rr.top-pr.top,
                    scroll:document.querySelector('[aria-label="Weekly overview"]').scrollTop,
                    card:${setup}.getBoundingClientRect().height,preview:preview.getBoundingClientRect().top,
                    width:pr.width,height:pr.height,transform:getComputedStyle(preview).transform});
                window.__disclosure.frame=requestAnimationFrame(sample);
            };sample();
        })()`)
        await js(expression)
        await pause(850)
        const frames = await js(
            `(() => {cancelAnimationFrame(window.__disclosure.frame);return window.__disclosure.frames})()`
        )
        const first = frames[0].top,
            last = frames.at(-1).top
        const direction = Math.sign(last - first)
        const reversals = frames.slice(1).filter((frame, i) => (frame.top - frames[i].top) * direction < -0.5)
        const range = (key) => Math.max(...frames.map((f) => f[key])) - Math.min(...frames.map((f) => f[key]))
        const metrics = {
            travel: last - first,
            reversals: reversals.length,
            relativeDrift: range('relative'),
            inkDrift: range('ink'),
            scrollDrift: range('scroll')
        }
        traces.push({ name, metrics, frames })
        if (reversals.length || metrics.relativeDrift > 0.25 || metrics.inkDrift > 0.25 || metrics.scrollDrift > 0.25)
            failures.push({ name, metrics })
    }
    await capture('close-step', `${setup}.querySelector('[data-step="accounts"] [data-title]').click()`)
    await capture('expand-step', `${setup}.querySelector('[data-step="repositories"] [data-title]').click()`)
    await capture('hide-checklist', `${setup}.querySelector('[aria-label="Hide checklist"]').click()`)
    await capture('expand-checklist', `${setup}.querySelector('[aria-label="Show checklist"]').click()`)
    await pause(300)

    // Replay fractional tail positions through the real preceding card's layout.
    // This freezes each position for a native paint, separating glyph raster jitter from movement timing.
    const original = await js(`({height:${setup}.getBoundingClientRect().height,inline:${setup}.style.height})`)
    const pixels = []
    let captureRect
    const scale = await js(`devicePixelRatio`)
    for (let index = 0; index <= 8; index++) {
        const offset = index / 8
        await js(`${setup}.style.height=${JSON.stringify(`${Number(original.height) + offset}px`)}`)
        await pause(40)
        const rect = await js(
            `(() => {const r=document.querySelector('.hub-preview-heading p').getBoundingClientRect();return {x:Math.floor(r.left),y:Math.floor(r.top)-4,width:Math.ceil(Math.min(r.width,650)),height:Math.ceil(r.height)+10,top:r.top}})()`
        )
        // Keep one physical crop origin: moving it across a CSS-pixel boundary
        // introduces display-scale rounding into the glyph centroid.
        captureRect ??= { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        const png = (await window.webContents.capturePage(captureRect)).toPNG()
        writeFileSync(join(output, `description-${index}.png`), png)
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        let weight = 0,
            moment = 0
        for (let y = 0; y < info.height; y++)
            for (let x = 0; x < info.width; x++) {
                const start = (y * info.width + x) * info.channels
                const ink = Math.max(0, Math.min(data[start], data[start + 1], data[start + 2]) - 30)
                weight += ink
                moment += ink * (y + 0.5)
            }
        if (!weight) throw new Error('Description capture contains no readable glyphs')
        pixels.push({
            offset,
            top: rect.top,
            centroid: moment / weight,
            baseline: moment / weight - (rect.top - captureRect.y) * scale
        })
    }
    await js(`${setup}.style.height=${JSON.stringify(original.inline)}`)
    const rasterDrift = Math.max(...pixels.map((p) => p.baseline)) - Math.min(...pixels.map((p) => p.baseline))
    if (rasterDrift > 0.35) failures.push({ name: 'fractional-text-raster', rasterDrift })
    writeFileSync(
        join(output, 'disclosure-motion.json'),
        JSON.stringify({ traces, pixels, rasterDrift, failures }, null, 2)
    )
    writeFileSync(join(output, 'disclosure.png'), (await window.webContents.capturePage()).toPNG())
    writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: !failures.length, failures }, null, 2))
    if (failures.length) throw new Error(`Description jitter: ${JSON.stringify(failures)}`)
}
