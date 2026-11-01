import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist/wght-italic.css'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/geist-mono/wght-italic.css'
import './components/arc/foundation.css'
import 'react-diff-view/style/index.css'
import './styles.css'
import './desktop.css'

import { checkpointBeforeUpdate } from './update-checkpoint'
let resumeWriting: (() => void) | undefined
let preparation = 0
window.journal.writing?.onPrepare(async () => {
    const ticket = ++preparation
    const resume = await checkpointBeforeUpdate()
    if (ticket !== preparation) resume()
    else resumeWriting = resume
})
window.journal.writing?.onResume(() => {
    preparation++
    resumeWriting?.()
    resumeWriting = undefined
})
// Keep index.html's dark theme until light mode is ready. Theme tokens stay available.
createRoot(document.getElementById('root')!).render(<App />)
