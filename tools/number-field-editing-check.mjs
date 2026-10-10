// Run this function in the browser with Settings > Preferences open.
// The real rendered glyphs are checked because DOM-only tests cannot catch this paint regression.
export async function checkNumberFieldEditing() {
    const input = document.querySelector('.settings [role="spinbutton"]')
    if (!input) throw new Error('Open Settings > Preferences before running the check.')
    const original = input.value
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const edit = async (draft) => {
        input.focus()
        setValue.call(input, draft)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const results = []
    try {
        for (const draft of ['11', '1120120']) {
            await edit(draft)
            const number = input.parentElement
            const display = number.querySelector('[aria-hidden="true"]')
            const mirror = Array.from(number.children).find((element) => element !== input && element !== display)
            if (!mirror || mirror.textContent !== draft) throw new Error('The number field did not enter editing mode.')
            const value = mirror.getBoundingClientRect()
            const suffix = number.nextElementSibling.getBoundingClientRect()
            const control = input.closest('[data-size]').children[1].getBoundingClientRect()
            const overlappingDigits = Array.from(display.querySelectorAll('[class*="_glyph_"]')).filter(
                (glyph) =>
                    getComputedStyle(glyph).visibility === 'visible' &&
                    Number(getComputedStyle(glyph).opacity) > 0.1 &&
                    glyph.getBoundingClientRect().width > 0 &&
                    glyph.getBoundingClientRect().height > 0
            ).length
            const centered = Math.abs((value.top + value.bottom - suffix.top - suffix.bottom) / 2) < 2
            if (!centered || value.top < control.top || value.bottom > control.bottom || overlappingDigits)
                throw new Error(`Editing ${draft}: centered=${centered}, overlapping digits=${overlappingDigits}`)
            results.push({ draft, centered, overlappingDigits })
        }
        input.blur()
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (input.getAttribute('aria-valuenow') !== '1440') throw new Error('Over-limit values must clamp on blur.')
        return results
    } finally {
        await edit(original)
        input.blur()
    }
}
