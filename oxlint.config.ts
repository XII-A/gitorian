import { defineConfig, type DummyRuleMap } from 'oxlint'

const frontendFiles = ['src/renderer/**/*.{ts,tsx}']
const backendFiles = [
    'src/main/**/*.ts',
    'src/preload/**/*.ts',
    'src/shared/**/*.ts',
    'tests/**/*.ts',
    '*.ts',
    'tools/**/*.{js,ts}'
]

const eslintRecommendedRules = {
    'for-direction': 'error',
    'no-array-constructor': 'error',
    'no-async-promise-executor': 'error',
    'no-case-declarations': 'error',
    'no-compare-neg-zero': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-constant-binary-expression': 'error',
    'no-constant-condition': ['error', { checkLoops: 'allExceptWhileTrue' }],
    'no-control-regex': 'error',
    'no-debugger': 'error',
    'no-delete-var': 'error',
    'no-dupe-else-if': 'error',
    'no-duplicate-case': 'error',
    'no-empty': ['error', { allowEmptyCatch: false }],
    'no-empty-character-class': 'error',
    'no-empty-function': ['error', { allow: [] }],
    'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: false }],
    'no-empty-static-block': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-fallthrough': ['error', { allowEmptyCase: false, reportUnusedFallthroughComment: false }],
    'no-global-assign': ['error', { exceptions: [] }],
    'no-invalid-regexp': 'error',
    'no-irregular-whitespace': [
        'error',
        { skipComments: false, skipJSXText: false, skipRegExps: false, skipStrings: true, skipTemplates: false }
    ],
    'no-loss-of-precision': 'error',
    'no-misleading-character-class': 'error',
    'no-nonoctal-decimal-escape': 'error',
    'no-prototype-builtins': 'error',
    'no-regex-spaces': 'error',
    'no-self-assign': ['error', { props: true }],
    'no-shadow-restricted-names': ['error', { reportGlobalThis: false }],
    'no-sparse-arrays': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-optional-chaining': ['error', { disallowArithmeticOperators: false }],
    'no-unused-expressions': ['error', { allowShortCircuit: false, allowTaggedTemplates: false, allowTernary: false }],
    'no-unused-labels': 'error',
    'no-unused-private-class-members': 'error',
    'no-useless-backreference': 'error',
    'no-useless-catch': 'error',
    'no-useless-constructor': 'error',
    'no-useless-escape': ['error', { allowRegexCharacters: [] }],
    'no-var': 'error',
    'prefer-const': ['error', { destructuring: 'any', ignoreReadBeforeAssign: false }],
    'prefer-rest-params': 'error',
    'prefer-spread': 'error',
    'require-yield': 'error',
    'use-isnan': ['error', { enforceForIndexOf: false, enforceForSwitchCase: true }],
    'valid-typeof': ['error', { requireStringLiterals: false }]
} satisfies DummyRuleMap

const typescriptStrictAndStylisticRules = {
    'typescript/adjacent-overload-signatures': 'error',
    'typescript/array-type': 'error',
    'typescript/await-thenable': 'error',
    'typescript/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
    'typescript/ban-tslint-comment': 'error',
    'typescript/class-literal-property-style': 'error',
    'typescript/consistent-generic-constructors': 'error',
    'typescript/consistent-indexed-object-style': 'error',
    'typescript/consistent-type-assertions': 'error',
    'typescript/consistent-type-definitions': 'error',
    'typescript/dot-notation': [
        'error',
        {
            allowIndexSignaturePropertyAccess: false,
            allowKeywords: true,
            allowPattern: '',
            allowPrivateClassPropertyAccess: false,
            allowProtectedClassPropertyAccess: false
        }
    ],
    'typescript/no-array-delete': 'error',
    'typescript/no-base-to-string': 'error',
    'typescript/no-confusing-non-null-assertion': 'error',
    'typescript/no-deprecated': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-duplicate-type-constituents': 'error',
    'typescript/no-dynamic-delete': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-extraneous-class': 'error',
    'typescript/no-for-in-array': 'error',
    'typescript/no-implied-eval': 'error',
    'typescript/no-inferrable-types': 'error',
    'typescript/no-invalid-void-type': 'error',
    'typescript/no-meaningless-void-operator': 'error',
    'typescript/no-misused-new': 'error',
    'typescript/no-misused-spread': 'error',
    'typescript/no-mixed-enums': 'error',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-nullish-coalescing': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'error',
    'typescript/no-redundant-type-constituents': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-boolean-literal-compare': 'error',
    'typescript/no-unnecessary-template-expression': 'error',
    'typescript/no-unnecessary-type-arguments': 'error',
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unnecessary-type-parameters': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-enum-comparison': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-unsafe-unary-minus': 'error',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/non-nullable-type-assertion-style': 'error',
    'typescript/only-throw-error': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-find': 'error',
    'typescript/prefer-for-of': 'error',
    'typescript/prefer-function-type': 'error',
    'typescript/prefer-includes': 'error',
    'typescript/prefer-literal-enum-member': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/prefer-optional-chain': 'error',
    'typescript/prefer-promise-reject-errors': 'error',
    'typescript/prefer-reduce-type-parameter': 'error',
    'typescript/prefer-regexp-exec': 'error',
    'typescript/prefer-return-this-type': 'error',
    'typescript/prefer-string-starts-ends-with': 'error',
    'typescript/related-getter-setter-pairs': 'error',
    'typescript/require-await': 'error',
    'typescript/restrict-plus-operands': [
        'error',
        {
            allowAny: false,
            allowBoolean: false,
            allowNullish: false,
            allowNumberAndString: false,
            allowRegExp: false
        }
    ],
    'typescript/return-await': ['error', 'error-handling-correctness-only'],
    'typescript/triple-slash-reference': 'error',
    'typescript/unified-signatures': 'error',
    'typescript/use-unknown-in-catch-callback-variable': 'error'
} satisfies DummyRuleMap

const sharedRuleOverrides = {
    'eslint-parity/computed-no-console': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'typescript/no-unused-vars': [
        'warn',
        {
            vars: 'all',
            varsIgnorePattern: '^_',
            args: 'after-used',
            argsIgnorePattern: '^_'
        }
    ],
    'typescript/consistent-type-imports': ['warn', { fixStyle: 'separate-type-imports', prefer: 'type-imports' }],
    'typescript/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    'typescript/no-explicit-any': 'warn',
    'typescript/await-thenable': 'off',
    'typescript/no-floating-promises': 'off',
    'typescript/no-misused-promises': ['error', { checksVoidReturn: { arguments: false, attributes: false } }],
    'typescript/no-non-null-assertion': 'off',
    'typescript/no-unnecessary-condition': 'off',
    'typescript/no-unnecessary-type-parameters': 'off',
    'typescript/no-unsafe-argument': 'off',
    'typescript/no-unsafe-assignment': 'off',
    'typescript/no-unsafe-call': 'off',
    'typescript/no-unsafe-member-access': 'off',
    'typescript/no-unsafe-return': 'off',
    'typescript/prefer-nullish-coalescing': 'off',
    'typescript/prefer-optional-chain': 'off',
    'typescript/restrict-template-expressions': 'off',
    'typescript/unbound-method': 'off'
} satisfies DummyRuleMap

const sharedRules = {
    ...eslintRecommendedRules,
    ...typescriptStrictAndStylisticRules,
    ...sharedRuleOverrides
} satisfies DummyRuleMap

const reactRecommendedRules = {
    'react/display-name': 'error',
    'react/jsx-key': 'error',
    'react/jsx-no-comment-textnodes': 'error',
    'react/jsx-no-duplicate-props': 'error',
    'react/jsx-no-target-blank': 'error',
    'react/jsx-no-undef': 'error',
    'react/no-children-prop': 'error',
    'react/no-danger-with-children': 'error',
    'react/no-direct-mutation-state': 'error',
    'react/no-find-dom-node': 'error',
    'react/no-is-mounted': 'error',
    'react/no-render-return-value': 'error',
    'react/no-string-refs': 'error',
    'react/no-unescaped-entities': 'error',
    'react/no-unknown-property': 'error',
    'react/require-render-return': 'error'
} satisfies DummyRuleMap

const reactHooksRecommendedRules = {
    'react/exhaustive-deps': 'warn',
    'react/rules-of-hooks': 'error'
} satisfies DummyRuleMap

const jsxA11yRecommendedRules = {
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/anchor-has-content': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/aria-activedescendant-has-tabindex': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error',
    'jsx-a11y/aria-role': 'error',
    'jsx-a11y/aria-unsupported-elements': 'error',
    'jsx-a11y/autocomplete-valid': 'error',
    'jsx-a11y/click-events-have-key-events': 'error',
    'jsx-a11y/heading-has-content': 'error',
    'jsx-a11y/html-has-lang': 'error',
    'jsx-a11y/iframe-has-title': 'error',
    'jsx-a11y/img-redundant-alt': 'error',
    'jsx-a11y/interactive-supports-focus': [
        'error',
        { tabbable: ['button', 'checkbox', 'link', 'searchbox', 'spinbutton', 'switch', 'textbox'] }
    ],
    'jsx-a11y/label-has-associated-control': 'error',
    'jsx-a11y/media-has-caption': 'error',
    'jsx-a11y/mouse-events-have-key-events': 'error',
    'jsx-a11y/no-access-key': 'error',
    'jsx-a11y/no-distracting-elements': 'error',
    'jsx-a11y/no-interactive-element-to-noninteractive-role': [
        'error',
        { tr: ['none', 'presentation'], canvas: ['img'] }
    ],
    'jsx-a11y/no-noninteractive-element-interactions': [
        'error',
        {
            handlers: [
                'onClick',
                'onError',
                'onLoad',
                'onMouseDown',
                'onMouseUp',
                'onKeyPress',
                'onKeyDown',
                'onKeyUp'
            ],
            alert: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
            body: ['onError', 'onLoad'],
            dialog: ['onKeyUp', 'onKeyDown', 'onKeyPress'],
            iframe: ['onError', 'onLoad'],
            img: ['onError', 'onLoad']
        }
    ],
    'jsx-a11y/no-noninteractive-element-to-interactive-role': [
        'error',
        {
            ul: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
            ol: ['listbox', 'menu', 'menubar', 'radiogroup', 'tablist', 'tree', 'treegrid'],
            li: ['menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'row', 'tab', 'treeitem'],
            table: ['grid'],
            td: ['gridcell'],
            fieldset: ['radiogroup', 'presentation']
        }
    ],
    'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: [], roles: ['tabpanel'], allowExpressionValues: true }],
    'jsx-a11y/no-redundant-roles': 'error',
    'jsx-a11y/no-static-element-interactions': [
        'error',
        {
            allowExpressionValues: true,
            handlers: ['onClick', 'onMouseDown', 'onMouseUp', 'onKeyPress', 'onKeyDown', 'onKeyUp']
        }
    ],
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/role-supports-aria-props': 'error',
    'jsx-a11y/scope': 'error',
    'jsx-a11y/tabindex-no-positive': 'error'
} satisfies DummyRuleMap

export default defineConfig({
    plugins: ['typescript', 'react', 'jsx-a11y'],
    jsPlugins: [
        'eslint-plugin-unused-imports',
        { name: 'eslint-parity', specifier: './tools/oxlint-rules/eslint-core.js' }
    ],
    categories: {
        correctness: 'off',
        suspicious: 'off',
        pedantic: 'off',
        perf: 'off',
        style: 'off',
        restriction: 'off',
        nursery: 'off'
    },
    options: {
        typeAware: true,
        respectEslintDisableDirectives: true
    },
    settings: {
        react: {
            version: '19.3.0'
        }
    },
    ignorePatterns: ['.ai-docs', 'node_modules', 'out', 'release', 'dist', 'coverage'],
    overrides: [
        {
            files: frontendFiles,
            env: {
                browser: true,
                es2022: true
            },
            rules: {
                ...sharedRules,
                ...reactRecommendedRules,
                ...reactHooksRecommendedRules,
                ...jsxA11yRecommendedRules,

                'jsx-a11y/no-autofocus': 'off',
                'jsx-a11y/role-has-required-aria-props': 'off',
                'react/jsx-props-no-spreading': 'off',
                'react/no-array-index-key': 'off',
                'react/react-in-jsx-scope': 'off'
            }
        },
        {
            files: backendFiles,
            env: {
                node: true,
                es2022: true
            },
            rules: sharedRules
        }
    ]
})
