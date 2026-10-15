import { lstat, readdir, realpath } from 'node:fs/promises'
import nodePath from 'node:path'

const ignored = new Set(['.git', 'node_modules', '.cache', '.venv', 'venv', 'vendor', '__pycache__'])

export const repositoryPathKey = (path: string): string => {
    if (!path) {
        return ''
    }
    const key = nodePath.normalize(nodePath.resolve(path))
    return process.platform === 'win32' ? key.toLowerCase() : key
}

const repositoryMarker = async (path: string) => {
    try {
        return await lstat(nodePath.join(path, '.git'))
    } catch (error) {
        if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
            return
        }
        throw error
    }
}

/** Discover working trees without following links or entering repository internals. */
export const discoverRepositories = async (
    folder: string,
    onProgress?: (counts: { scanned: number; found: number }) => void
): Promise<{ paths: string[]; unreadable: string[] }> => {
    const paths: string[] = []
    const unreadable: string[] = []
    let scanned = 0
    const visit = async (path: string): Promise<void> => {
        let descendants: string[] = []
        try {
            const marker = await repositoryMarker(path)
            if (marker?.isDirectory() || marker?.isFile()) {
                paths.push(path)
            } else {
                const children = await readdir(path, { withFileTypes: true })
                descendants = children
                    .toSorted((a, b) => a.name.localeCompare(b.name))
                    .filter((child) => child.isDirectory() && !ignored.has(child.name))
                    .map((child) => nodePath.join(path, child.name))
            }
        } catch {
            unreadable.push(path)
        } finally {
            scanned += 1
            onProgress?.({ found: paths.length, scanned })
        }
        for await (const child of descendants) {
            await visit(child)
        }
    }
    await visit(await realpath(folder))
    return { paths, unreadable }
}
