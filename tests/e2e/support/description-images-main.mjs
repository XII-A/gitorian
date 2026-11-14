import { app } from 'electron'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from '../../../tools/seed-journal.mjs'

const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('An owned desktop test profile is required')
app.setPath('userData', profile)
const { state } = await tsImport('./description-images-fixture.ts', import.meta.url)
state.repositories[0].path = resolve(profile, 'unavailable-repository')
await seedJournal(profile, state)
await import(pathToFileURL(resolve('out/main/index.js')).href)
