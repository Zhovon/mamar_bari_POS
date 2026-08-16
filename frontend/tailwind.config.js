/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0F172A', // Slate 900
        surface: 'rgba(30, 41, 59, 0.7)', // Slate 800 with opacity for glass
        primary: '#3B82F6', // Blue 500
        secondary: '#10B981', // Emerald 500
        accent: '#F59E0B', // Amber 500
      }
    },
  },
  plugins: [],
}
