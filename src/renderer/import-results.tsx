import type { State } from '../shared/model'
import { readableError } from './background-work'

export const ImportResults = ({ job }: { job: State['repositoryImport'] }) => {
    if (!job) {
        return <p>No import results available.</p>
    }
    return (
        <>
            <p>{job.status === 'error' ? readableError(job.message ?? '') : job.message}</p>
            {job.skippedItems?.map((item) => (
                <div className="import-result" key={item.path}>
                    <strong>{item.path}</strong>
                    <p>
                        Could not import this folder. Check its permissions and Git repository, then add the folder
                        again.
                    </p>
                </div>
            ))}
        </>
    )
}
