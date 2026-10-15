import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'
import react from 'ultracite/oxlint/react'
import vitest from 'ultracite/oxlint/vitest'

export default defineConfig({
    env: { browser: true },
    extends: [core, react, vitest],
    ignorePatterns: ['.ai-docs', 'node_modules', 'out', 'release', 'dist', 'coverage'],
    jsPlugins: [
        'eslint-plugin-unused-imports',
        {
            name: 'eslint-parity',
            specifier: './tools/oxlint-rules/eslint-core.js'
        }
    ],
    options: {
        respectEslintDisableDirectives: true,
        typeAware: false
    },
    overrides: [
        {
            env: {
                browser: true,
                es2022: true
            },
            files: ['src/renderer/**/*.{ts,tsx}'],
            rules: {
                'eslint-parity/computed-no-console': 'error',
                'react/require-render-return': 'error',
                'typescript/no-unused-vars': [
                    'error',
                    {
                        args: 'after-used',
                        argsIgnorePattern: '^_',
                        vars: 'all',
                        varsIgnorePattern: '^_'
                    }
                ],
                'unused-imports/no-unused-imports': 'error'
            }
        },
        {
            env: {
                es2022: true,
                node: true
            },
            files: [
                'src/main/**/*.ts',
                'src/preload/**/*.ts',
                'src/shared/**/*.ts',
                'tests/**/*.ts',
                '*.ts',
                'tools/**/*.{js,mjs,ts}'
            ],
            rules: {
                'eslint-parity/computed-no-console': 'error',
                'typescript/no-unused-vars': [
                    'error',
                    {
                        args: 'after-used',
                        argsIgnorePattern: '^_',
                        vars: 'all',
                        varsIgnorePattern: '^_'
                    }
                ],
                'unused-imports/no-unused-imports': 'error'
            }
        }
    ],
    rules: {
        'no-console': ['error', { allow: ['warn', 'error', 'info'] }]
    },
    settings: {
        'jsx-a11y': {
            components: {
                'motion.button': 'button',
                'motion.dialog': 'dialog',
                'motion.div': 'div',
                'motion.input': 'input',
                'motion.option': 'option',
                'motion.output': 'output',
                'motion.select': 'select',
                'motion.span': 'span',
                'motion.svg': 'svg'
            }
        },
        react: { version: '19.3.0' }
    }
})
