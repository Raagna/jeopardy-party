import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative paths work on localhost, a user site, and a project site.
  base: './',
  plugins: [react()],
})
