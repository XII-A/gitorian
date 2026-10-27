import { defineConfig } from '@playwright/test'
import { randomUUID } from 'node:crypto'

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    outputDir: `.ai-docs/verification/desktop/runs/${Date.now()}-${randomUUID().slice(0, 8)}`,
    timeout: 120_000,
    expect: { timeout: 10_000 },
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    reporter: [
        ['list'],
        ['./tests/e2e/support/evidence-reporter.ts'],
        ['html', { outputFolder: '.ai-docs/verification/desktop/report', open: 'never' }]
    ]
})
