import { lstat, readdir, realpath } from 'node:fs/promises'
import nodePath from 'node:path'

import { required } from '../shared/required'

const ignored = new Set(['.git', 'node_modules', '.cache', '.venv', 'venv', 'vendor', '__pycache__'])

export const repositoryPathKey = (path: string): string => {
    if (!path) {
        return ''
    }
    const key = nodePath.normalize(nodePath.resolve(path))
    return process.platform === 'win32' ? key.toLowerCase() : key
}

/** Discover working trees without following links or entering repository internals. */
export const discoverRepositories = async (
    folder: string,
    onProgress?: (counts: { scanned: number; found: number }) => void
): Promise<{ paths: string[]; unreadable: string[] }> => {
    const pending = [await realpath(folder)]
    const paths: string[] = []
    const unreadable: string[] = []
    let scanned = 0
    while (pending.length) {
        const path = required(pending.pop())
        try {
            const marker = await lstat(nodePath.join(path, '.git')).catch((error: unknown) => {
                if (
                    error instanceof Error &&
                    'code' in error &&
                    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                ) {
                    return
                }
                throw error
            })
            if (marker?.isDirectory() || marker?.isFile()) {
                paths.push(path)
                continue
            }
            const children = await readdir(path, { withFileTypes: true })
            for (const child of children.toSorted((a, b) => b.name.localeCompare(a.name))) {
                if (child.isDirectory() && !ignored.has(child.name)) {
                    pending.push(nodePath.join(path, child.name))
                }
            }
        } catch {
            unreadable.push(path)
        } finally {
            scanned += 1
            onProgress?.({ found: paths.length, scanned })
        }
    }
    return { paths, unreadable }
}
