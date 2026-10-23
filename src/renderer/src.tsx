import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/inter'
import './components/arc/foundation.css'
import 'react-diff-view/style/index.css'
import './styles.css'
import './desktop.css'

// Keep index.html's dark theme until light mode is ready. Theme tokens stay available.
createRoot(document.getElementById('root')!).render(<App />)
