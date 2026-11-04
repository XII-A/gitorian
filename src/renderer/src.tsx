import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist/wght-italic.css'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/geist-mono/wght-italic.css'
import './components/arc/foundation.css'
import './code-highlighting.css'
import './styles.css'
import './desktop.css'

// Keep index.html's dark theme until light mode is ready. Theme tokens stay available.
window.addEventListener('error', () => window.journal.diagnostics?.error('render'))
window.addEventListener('unhandledrejection', () => window.journal.diagnostics?.error('promise'))
createRoot(document.getElementById('root')!).render(<App />)
