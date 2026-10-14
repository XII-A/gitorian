import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

export default defineConfig({
    ...ultracite,
    ignorePatterns: [
        ...(ultracite.ignorePatterns ?? []),
        '/.ai-docs',
        '/dist',
        '/coverage',
        '/node_modules',
        '**/dist',
        '**/node_modules',
        '/out',
        '/release',
        '/package-lock.json',
        '/.agents'
    ],
    printWidth: 120,
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
    sortTailwindcss: {},
    tabWidth: 4,
    trailingComma: 'none'
})
