/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'linklabs': {
          50: '#eff8ff',
          100: '#dbeefe',
          200: '#bfe3fe',
          300: '#93d2fd',
          400: '#60b8fa',
          500: '#3b9af6',
          600: '#257deb',
          700: '#1d66d8',
          800: '#1e53af',
          900: '#1e488a',
          950: '#172d54',
        }
      }
    },
  },
  plugins: [],
}
