/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // PressChain design tokens — exact values, no deviations.
        base: '#0a0a0f', // root background
        panel: '#111118', // cards, sidebar
        input: '#1a1a24', // text inputs
        edge: '#1f2937', // all borders, 1px solid
        accent: '#4ade80', // green — CTAs, active states, Tor indicator
        'accent-dim': '#16a34a', // hover states
        primary: '#f0f0f0', // text primary
        muted: '#6b7280', // text muted
        danger: '#f87171', // flagged/removed states
        warning: '#fbbf24' // flag count warnings
      },
      fontFamily: {
        ui: ['system-ui', 'sans-serif'],
        article: ['Georgia', "'Times New Roman'", 'serif']
      }
    }
  },
  plugins: []
}
