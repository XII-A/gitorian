import type { SVGProps } from 'react'

export function WorkspaceIcon({
    name,
    ...props
}: SVGProps<SVGSVGElement> & {
    name: 'back' | 'commit' | 'pr' | 'branch' | 'popout' | 'close' | 'book' | 'focus' | 'refresh' | 'check'
}) {
    const paths = {
        back: <path d="m14 5-7 7 7 7M7 12h14" />,
        commit: (
            <>
                <path d="M2 12h6m8 0h6" />
                <circle cx="12" cy="12" r="4" />
            </>
        ),
        pr: (
            <>
                <circle cx="6" cy="5" r="2" />
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="19" r="2" />
                <path d="M6 7v10m12 0v-6c0-4-6-4-6-4m3-3-3 3 3 3" />
            </>
        ),
        branch: (
            <>
                <circle cx="6" cy="5" r="2" />
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="5" r="2" />
                <path d="M6 7v10m12-10c0 7-12 3-12 9" />
            </>
        ),
        popout: (
            <>
                <path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" />
            </>
        ),
        close: <path d="m6 6 12 12M6 18 18 6" />,
        book: (
            <>
                <path d="M12 5v15M3 4h5c2 0 4 1 4 3 0-2 2-3 4-3h5v15h-5c-2 0-4 1-4 2 0-1-2-2-4-2H3Z" />
            </>
        ),
        focus: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
        refresh: <path d="M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5M4 15a8 8 0 0 0 14 4l3-3m0 5v-5h-5" />,
        check: <path d="m5 12 4 4L19 6" />
    }
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...props}
        >
            {paths[name]}
        </svg>
    )
}
