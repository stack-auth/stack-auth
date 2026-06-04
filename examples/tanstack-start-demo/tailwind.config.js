/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", 'html:has(head > [data-stack-theme="dark"])'],
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
