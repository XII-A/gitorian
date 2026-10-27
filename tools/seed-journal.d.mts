import type { State } from '../src/shared/model'
export function seedJournal(
    profile: string,
    state: State,
    images?: { id: string; mime: string; width: number; height: number; bytes: string }[]
): Promise<void>
