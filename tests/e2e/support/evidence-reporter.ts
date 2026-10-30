import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter'

export default class EvidenceReporter implements Reporter {
    onTestEnd(_test: TestCase, result: TestResult) {
        const report = result.attachments.find((item) => item.name === 'desktop-run')
        if (!report?.path) return
        const run = JSON.parse(readFileSync(report.path, 'utf8')) as { output: string; passed: boolean; error: string }
        const events: object[] = []
        function record(steps: TestStep[], depth = 0) {
            for (const step of steps) {
                events.push({
                    time: step.startTime.toISOString(),
                    action: step.title,
                    duration: step.duration,
                    depth,
                    error: step.error?.message
                })
                record(step.steps, depth + 1)
            }
        }
        record(result.steps)
        writeFileSync(join(run.output, 'actions.jsonl'), events.map((event) => JSON.stringify(event)).join('\n'))
        run.passed &&= result.status === 'passed'
        run.error ||= result.error?.message ?? ''
        writeFileSync(join(run.output, 'run.json'), JSON.stringify(run, null, 2))
        writeFileSync(report.path, JSON.stringify(run, null, 2))
    }
}
