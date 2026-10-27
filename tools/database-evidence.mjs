/** Independent, read-only SQL evidence after the Electron journey exits. */
export function activityEvidence(db) {
    const files = db.prepare('SELECT * FROM activity_files ORDER BY position').all()
    return db
        .prepare('SELECT * FROM activities WHERE journaled=1')
        .all()
        .map((row) => ({
            ...row,
            date: new Date(row.occurredAt).toISOString(),
            filesLoaded: !!row.filesLoaded,
            files: files
                .filter((file) => file.activityId === row.id)
                .map((file) => ({
                    name: file.name,
                    status: file.status,
                    previousName: file.previousName ?? undefined,
                    lineStats: file.binary
                        ? null
                        : file.additions === null
                          ? undefined
                          : { additions: file.additions, deletions: file.deletions }
                }))
        }))
}
