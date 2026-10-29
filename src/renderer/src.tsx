import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initializeAppearance } from './appearance'
import '@fontsource-variable/geist'
import '@fontsource-variable/inter'
import './components/arc/foundation.css'
import 'react-diff-view/style/index.css'
import './styles.css'
import './desktop.css'
import './appearance.css'

initializeAppearance()
createRoot(document.getElementById('root')!).render(<App />)
