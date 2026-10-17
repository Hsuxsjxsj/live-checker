import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/index.css'

import { App } from './app'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('APP_ROOT_NOT_FOUND')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
