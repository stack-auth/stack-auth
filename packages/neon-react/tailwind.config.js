
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["selector", 'html:has(head > [data-stack-theme="dark"])'],
  content: [
    "./src/**/*.{ts,tsx}",
    "./node_modules/@stackframe/stack-ui/src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "rgb(209 213 219)",
        input: "rgb(209 213 219)",
        ring: "rgb(16 185 129)",
        background: "rgb(255 255 255)",
        foreground: "rgb(17 24 39)",
        primary: {
          DEFAULT: "rgb(16 185 129)",
          foreground: "rgb(255 255 255)",
        },
        secondary: {
          DEFAULT: "rgb(52 211 153)",
          foreground: "rgb(17 24 39)",
        },
        destructive: {
          DEFAULT: "rgb(239 68 68)",
          foreground: "rgb(255 255 255)",
        },
        success: {
          DEFAULT: "rgb(16 185 129)",
          foreground: "rgb(255 255 255)",
        },
        muted: {
          DEFAULT: "rgb(243 244 246)",
          foreground: "rgb(107 114 128)",
        },
        accent: {
          DEFAULT: "rgb(110 231 183)",
          foreground: "rgb(17 24 39)",
        },
        popover: {
          DEFAULT: "rgb(255 255 255)",
          foreground: "rgb(17 24 39)",
        },
        card: {
          DEFAULT: "rgb(255 255 255)",
          foreground: "rgb(17 24 39)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
