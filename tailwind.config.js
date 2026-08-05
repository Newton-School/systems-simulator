/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nss: {
          // Base Layout
          bg: 'var(--nss-bg)',
          panel: 'var(--nss-panel)',
          surface: 'var(--nss-surface)',
          'input-bg': 'var(--nss-input-bg)',

          // Borders & Text
          border: 'var(--nss-border)',
          borderHigh: 'var(--nss-border-high)',
          text: 'var(--nss-text)',
          muted: 'var(--nss-muted)',
          placeholder: 'var(--nss-placeholder)',

          // Functional Colors (Using rgb wrapper to allow /opacity modifiers)
          primary: 'rgb(var(--nss-primary) / <alpha-value>)',
          'primary-hover': 'rgb(var(--nss-primary-hover) / <alpha-value>)',
          success: 'rgb(var(--nss-success) / <alpha-value>)',
          warning: 'rgb(var(--nss-warning) / <alpha-value>)',
          danger: 'rgb(var(--nss-danger) / <alpha-value>)',
          info: 'rgb(var(--nss-info) / <alpha-value>)'
        }
      }
    }
  },
  plugins: []
}
