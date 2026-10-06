import { createRoot } from 'react-dom/client'
import { App } from './App'
import './components/arc/foundation.css'
import 'react-diff-view/style/index.css'
import './styles.css'
import './desktop.css'

createRoot(document.getElementById('root')!).render(<App />)
