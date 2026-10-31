;(() => {
    const gsap = window.gsap
    if (!gsap) return

    const media = gsap.matchMedia()
    media.add(
        { reduced: '(prefers-reduced-motion: reduce)', full: '(prefers-reduced-motion: no-preference)' },
        (context) => {
            const reduced = context.conditions.reduced
            // The product image settles into place; copy and download links stay immediately available.
            const entrance = gsap.from('.journal-figure', {
                opacity: 0,
                y: reduced ? 0 : 8,
                duration: reduced ? 0.2 : 0.24,
                ease: 'power3.out',
                clearProps: 'opacity,transform'
            })

            return () => entrance.revert()
        }
    )
})()
