import { createOAuthHandler, oauthConfig } from './handler'

export default (request: Request) => createOAuthHandler(oauthConfig(process.env))(request)
export const config = { path: ['/authorize', '/callback', '/token', '/refresh', '/health'] }
