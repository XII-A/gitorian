import { Schema } from 'effect'

export const credentialSchema = Schema.Struct({
    access_token: Schema.NonEmptyString,
    refresh_token: Schema.NonEmptyString,
    workspace_id: Schema.NonEmptyString
})
export type OAuthCredentials = typeof credentialSchema.Type
export const attemptLifetime = 10 * 60_000
export const callbackPath = '/callback'
