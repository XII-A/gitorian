import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from '../../../tools/seed-journal.mjs'

const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('An owned desktop test profile is required')
app.setPath('userData', profile)
mkdirSync(profile, { recursive: true })
const { state } = await tsImport('./mermaid-fixture.ts', import.meta.url)
await seedJournal(profile, state)
await import(pathToFileURL(resolve('out/main/index.js')).href)
