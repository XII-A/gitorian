import { lstat, opendir, realpath } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'

const ignored = new Set(['.git', 'node_modules', '.cache', '.venv', 'venv', 'vendor', '__pycache__'])

export function repositoryPathKey(path: string): string {
    if (!path) return ''
    const key = normalize(resolve(path))
    return process.platform === 'win32' ? key.toLowerCase() : key
}

/** Discover working trees without following links or entering repository internals. */
export async function discoverRepositories(
    folder: string,
    onProgress?: (counts: { scanned: number; found: number }) => void,
    signal?: AbortSignal
): Promise<{ paths: string[]; unreadable: string[]; incomplete?: string }> {
    const pending = [await realpath(folder)]
    let pendingBytes = pending[0].length * 2
    const partial = () => ({
        paths,
        unreadable,
        incomplete:
            'Folder scan reached its work limit. These are partial results; choose a narrower folder to find the remaining repositories.'
    })
    const paths: string[] = []
    const unreadable: string[] = []
    const started = Date.now()
    let scanned = 0
    while (pending.length) {
        signal?.throwIfAborted()
        if (scanned >= 100000 || paths.length >= 10000 || Date.now() - started > 30000) return partial()
        const path = pending.pop()!
        pendingBytes -= path.length * 2
        try {
            const marker = await lstat(join(path, '.git')).catch((error: unknown) => {
                if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
                    return undefined
                throw error
            })
            if (marker?.isDirectory() || marker?.isFile()) {
                paths.push(path)
                continue
            }
            const children: string[] = []
            let childrenBytes = 0
            for await (const child of await opendir(path)) {
                signal?.throwIfAborted()
                if (Date.now() - started > 30000) return partial()
                if (!child.isDirectory() || ignored.has(child.name)) continue
                const full = join(path, child.name)
                childrenBytes += full.length * 2
                if (pending.length + children.length >= 100000 || pendingBytes + childrenBytes > 16_000_000)
                    return partial()
                children.push(full)
            }
            for (const child of children.sort((a, b) => b.localeCompare(a))) pending.push(child)
            pendingBytes += childrenBytes
        } catch {
            signal?.throwIfAborted()
            unreadable.push(path)
        } finally {
            scanned++
            onProgress?.({ scanned, found: paths.length })
        }
    }
    return { paths, unreadable }
}
