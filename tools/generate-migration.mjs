import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Kit models columns/relationships; these SQLite guarantees still require reviewed SQL.
const root = resolve('resources/migrations')
const previous = new Set(existsSync(root) ? readdirSync(root) : [])
const require = createRequire(import.meta.url)
const binary = join(dirname(require.resolve('drizzle-kit')), 'bin.cjs')
const result = spawnSync(process.execPath, [binary, 'generate', ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: true
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
for (const folder of readdirSync(root)) {
    if (previous.has(folder)) continue // Published migration hashes are immutable.
    const file = join(root, folder, 'migration.sql')
    if (!existsSync(file)) continue
    let sql = readFileSync(file, 'utf8')
    sql = sql.replace(/CREATE TABLE[\s\S]*?\n\);/g, (statement) => statement.replace(/\n\);$/, '\n) STRICT;'))
    sql = sql
        .split('\n')
        .map((line) => {
            if (
                !/CONSTRAINT [`"]activity_(current|cached)_revision[`"] FOREIGN KEY/.test(line) ||
                line.includes('DEFERRABLE')
            )
                return line
            return line.endsWith(',')
                ? line.slice(0, -1) + ' DEFERRABLE INITIALLY DEFERRED,'
                : line + ' DEFERRABLE INITIALLY DEFERRED'
        })
        .join('\n')
    writeFileSync(file, sql)
}
