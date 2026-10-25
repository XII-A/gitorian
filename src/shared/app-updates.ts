export type AppUpdateState =
    | { status: 'unavailable' | 'idle' | 'checking' | 'current' }
    | { status: 'downloading'; version: string; percent: number }
    | { status: 'ready'; version: string; error?: string }
    | { status: 'installing'; version: string }
    | { status: 'error'; message: string }

export type AppUpdateAction = 'check' | 'install'
