/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (dark navy). Chart colours live in src/components/charts/theme.ts.
        page: '#0a1222',
        surface: '#0f1a2e',
        raised: '#14223a',
        line: '#1e2a40',
        edge: '#2d3b55',
        ink: { DEFAULT: '#eef2f7', secondary: '#c3cad6', muted: '#8a94a6' },
        accent: { DEFAULT: '#22d3ee', soft: '#0e3a47' },
        forecast: '#1aa0bf',
        actual: '#c98500',
        later: '#9085e9',
        good: '#0ca30c',
        warning: '#fab219',
        critical: '#d03b3b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
