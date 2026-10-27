/** Promise request interface consumed by native provider adapters during migration. */
export interface ProviderHttp {
    readonly request: <T>(
        url: string,
        token: string,
        init?: RequestInit,
        format?: 'json' | 'text',
        options?: { background?: boolean; maxBytes?: number }
    ) => Promise<T>
}
