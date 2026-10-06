export default {
    rules: {
        'computed-no-console': {
            meta: {
                type: 'suggestion',
                messages: {
                    unexpected:
                        'Unexpected console statement. Only these console methods are allowed: warn, error, info.'
                }
            },
            create(context) {
                const sourceCode = context.sourceCode ?? context.getSourceCode()
                const comments = sourceCode.getAllComments()

                const isDisabledForNoConsole = (node) =>
                    comments.some((comment) => {
                        const value = comment.value
                        const disablesNoConsole =
                            /eslint-disable-next-line\b.*\bno-console\b/u.test(value) ||
                            /eslint-disable-line\b.*\bno-console\b/u.test(value)

                        return (
                            disablesNoConsole &&
                            (comment.loc.end.line === node.loc.start.line - 1 ||
                                comment.loc.start.line === node.loc.start.line)
                        )
                    })

                return {
                    MemberExpression(node) {
                        if (
                            node.computed &&
                            node.object?.type === 'Identifier' &&
                            node.object.name === 'console' &&
                            !isDisabledForNoConsole(node)
                        ) {
                            context.report({ node, messageId: 'unexpected' })
                        }
                    }
                }
            }
        }
    }
}
