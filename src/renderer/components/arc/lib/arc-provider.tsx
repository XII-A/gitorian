'use client'

import type { AnchorHTMLAttributes, ComponentType, ImgHTMLAttributes, ReactNode, Ref } from 'react'
import { createContext, createElement, useContext, useMemo } from 'react'

/**
 * Lets an app swap the link and image elements Arc components render (kuratlielia/arc-library#13).
 *
 * Without a provider, Arc renders a plain `<a>` and `<img>`, so components work in any React app (Vite, Remix, Astro,
 * plain React). Wrap the app once to use your framework's or your own components instead:
 *
 *   import Link from "next/link";
 *   import Image from "next/image";
 *   import { ArcProvider } from "@/components/arc/lib/arc-provider";
 *
 *   <ArcProvider link={Link} image={Image}>{children}</ArcProvider>
 *
 * Any component that accepts these props works, such as a locale-aware Link from next-intl or a React Router Link
 * wrapped to map `href` to `to`.
 */

/** The props Arc passes to a link: an href plus ordinary anchor attributes. */
export interface ArcLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string
    ref?: Ref<HTMLAnchorElement>
}

/**
 * The props Arc passes to an image. A subset of next/image's props, so next/image can be passed as is: either `fill`
 * (cover the positioned parent) or `width` and `height`, plus `sizes` and `priority` as hints.
 */
export interface ArcImageProps extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'src' | 'alt' | 'width' | 'height' | 'loading' | 'srcSet'
> {
    src: string
    alt: string
    width?: number
    height?: number
    /** Fills the nearest positioned parent, like next/image's `fill`. */
    fill?: boolean
    /** Loads the image eagerly with high priority, like next/image's `priority`. */
    priority?: boolean
    loading?: 'eager' | 'lazy'
    ref?: Ref<HTMLImageElement>
}

export type ArcLinkComponent = ComponentType<ArcLinkProps>
export type ArcImageComponent = ComponentType<ArcImageProps>

/** The default link: a plain anchor. */
export const ArcAnchor = ({ children, ...props }: ArcLinkProps) => <a {...props}>{children}</a>

const fillStyle = { height: '100%', inset: 0, position: 'absolute', width: '100%' } as const

/** The default image: a plain, lazily decoded `<img>` that understands `fill` and `priority`. */
export const ArcImg = ({ alt, fill, priority, loading, style, ...props }: ArcImageProps) => (
    // eslint-disable-next-line @next/next/no-img-element -- the framework-free default; pass next/image through ArcProvider instead.
    <img
        alt={alt}
        decoding="async"
        {...props}
        loading={loading ?? (priority ? 'eager' : 'lazy')}
        fetchPriority={priority ? 'high' : props.fetchPriority}
        style={fill ? { ...fillStyle, ...style } : style}
    />
)

interface ArcComponents {
    link: ArcLinkComponent
    image: ArcImageComponent
}

const ArcContext = createContext<ArcComponents>({ image: ArcImg, link: ArcAnchor })

export interface ArcProviderProps {
    /** The link component Arc renders for navigation, such as next/link or your own wrapped Link. Defaults to `<a>`. */
    link?: ArcLinkComponent
    /** The image component Arc renders for photos, such as next/image. Defaults to `<img>`. */
    image?: ArcImageComponent
    children: ReactNode
}

/** Sets the link and image components for every Arc component inside it. Nested providers inherit what they do not set. */
export const ArcProvider = ({ link, image, children }: ArcProviderProps) => {
    const parent = useContext(ArcContext)
    const value = useMemo(() => ({ image: image ?? parent.image, link: link ?? parent.link }), [link, image, parent])
    return <ArcContext.Provider value={value}>{children}</ArcContext.Provider>
}

/** The link component from the nearest ArcProvider, or a plain anchor. */
export const useArcLink = () => useContext(ArcContext).link
/** The image component from the nearest ArcProvider, or a plain img. */
export const useArcImage = () => useContext(ArcContext).image

/** What Arc components render for a link: the provider's link component, or a plain anchor. */
export const ArcLink = (props: ArcLinkProps) => createElement(useArcLink(), props)

/** What Arc components render for an image: the provider's image component, or a plain img. */
export const ArcImage = (props: ArcImageProps) => createElement(useArcImage(), props)
