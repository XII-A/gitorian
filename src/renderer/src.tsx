import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import './components/arc/foundation.css'
import 'react-diff-view/style/index.css'
import './styles.css'
import './desktop.css'

const appearance = window.matchMedia('(prefers-color-scheme: dark)')
const syncAppearance = () => {
    document.documentElement.dataset.theme = appearance.matches ? 'dark' : 'light'
}
syncAppearance()
appearance.addEventListener('change', syncAppearance)
createRoot(document.getElementById('root')!).render(<App />)
