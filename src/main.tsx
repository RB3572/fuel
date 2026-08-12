import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './enhancements.css'
import './FuelContextEnergy.css'
import './dashboard-enhancer.ts'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
