import { mount } from 'svelte'
import { registerSW } from 'virtual:pwa-register'
import './ui/fonts.css'
import './ui/theme.css'
import App from './App.svelte'

// autoUpdate: the new service worker activates and the page reloads itself.
registerSW({ immediate: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
