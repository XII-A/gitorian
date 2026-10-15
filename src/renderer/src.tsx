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
const parameters = new URLSearchParams(window.location.search)
const requestedWeek = parameters.get('week')
const referenceKind = parameters.get('reference')
const referenceId = parameters.get('id')
const route = {
    reference: referenceKind && referenceId ? { id: referenceId, kind: referenceKind } : undefined,
    screen: parameters.has('workspace') || parameters.has('reference') ? ('workspace' as const) : ('hub' as const),
    week:
        requestedWeek &&
        /^\d{4}-\d{2}-\d{2}$/u.test(requestedWeek) &&
        !Number.isNaN(Date.parse(`${requestedWeek}T12:00:00Z`))
            ? requestedWeek
            : ''
}
createRoot(required(document.querySelector('#root'))).render(<App route={route} />)
