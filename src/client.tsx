import App, { Model } from './components/app'
import { createRoot } from 'react-dom/client'
import React from 'react'
import { models } from './config'

window.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('root')
    if (!root) throw new Error('App root not found')
    createRoot(root).render(<App {...{ models }} />)
})
