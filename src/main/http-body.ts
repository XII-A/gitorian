import { HttpError } from './http-error'

const tooLarge = () => new HttpError(413, 'Changes are too large to display. Open the source externally.')

export const readResponseBody = async (response: Response, maxBytes: number): Promise<string> => {
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        await response.body?.cancel()
        throw tooLarge()
    }
    if (!response.body) {
        return ''
    }
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    for await (const chunk of response.body) {
        bytes += chunk.byteLength
        if (bytes > maxBytes) {
            // Exiting the async iterator cancels its reader and releases the lock.
            throw tooLarge()
        }
        text += decoder.decode(chunk, { stream: true })
    }
    return text + decoder.decode()
}
