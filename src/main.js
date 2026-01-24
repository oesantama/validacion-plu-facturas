import { createApp } from 'vue'
import { Quasar, Notify, Loading, Dialog } from 'quasar'

// Import icon libraries
import '@quasar/extras/material-icons/material-icons.css'
import '@quasar/extras/mdi-v7/mdi-v7.css'

// Import Quasar css
import 'quasar/src/css/index.sass'

// Import root component
import App from './App.vue'

const myApp = createApp(App)

myApp.use(Quasar, {
  plugins: {
    Notify,
    Loading,
    Dialog
  },
  config: {
    notify: {},
    loading: {}
  }
})

myApp.mount('#app')
