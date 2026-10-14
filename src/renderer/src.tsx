import '@fontsource-variable/geist'
import '@fontsource-variable/inter'
import 'react-diff-view/style/index.css'
import { createRoot } from 'react-dom/client'

import { required } from '../shared/required'
import { App } from './app'

import './components/arc/foundation.css'
import './desktop.css'
import './styles.css'

const appearance = window.matchMedia('(prefers-color-scheme: dark)')
const syncAppearance = () => {
    document.documentElement.dataset.theme = appearance.matches ? 'dark' : 'light'
}
syncAppearance()
appearance.addEventListener('change', syncAppearance)
createRoot(required(document.querySelector('#root'))).render(<App />)
