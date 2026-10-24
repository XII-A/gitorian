import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotionSetupStore } from '../src/main/notion-setup'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))
function file() {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-notion-setup-'))
    directories.push(directory)
    return join(directory, 'setup.json')
}
it('restores workspace-specific recovery after process memory is lost and clears only acknowledged setup', () => {
    const path = file()
    const store = new NotionSetupStore(path)
    const setup = { id: 'marker-one', started: true, title: 'Work journal' }
    store.set('workspace-one', setup)
    store.set('workspace-two', { id: 'marker-two', started: true, pageId: 'created-page' })
    expect(new NotionSetupStore(path).get('workspace-one')).toEqual(setup)
    store.clear('workspace-one')
    expect(new NotionSetupStore(path).get('workspace-one')).toBeUndefined()
    expect(new NotionSetupStore(path).get('workspace-two')?.pageId).toBe('created-page')
    expect(readFileSync(path, 'utf8')).not.toMatch(/access_token|refresh_token/)
})
it('fails closed on damaged recovery rather than authorizing another creation', () => {
    const path = file()
    writeFileSync(path, '{broken')
    expect(() => new NotionSetupStore(path).get('workspace-one')).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('{broken')
})
it('reports checkpoint write failure synchronously before a caller can create a remote page', () => {
    const path = file()
    writeFileSync(path, '{}')
    const store = new NotionSetupStore(join(path, 'cannot-write.json'))
    let created = false
    expect(() => {
        store.set('workspace-one', { id: 'marker', started: true })
        created = true
    }).toThrow()
    expect(created).toBe(false)
})
