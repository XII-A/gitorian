const formatters = new Map<number, Intl.NumberFormat>()
/** Avoid presenting a positive category as 0%, while keeping ordinary shares concise. */
export function formatWaffleShare(value: number, decimals: number) {
    let formatter = formatters.get(decimals)
    if (!formatter) {
        formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals })
        formatters.set(decimals, formatter)
    }
    const threshold = 10 ** -decimals
    return value > 0 && value < threshold ? `<${formatter.format(threshold)}` : formatter.format(value)
}
