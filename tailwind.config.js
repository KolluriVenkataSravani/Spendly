import forms from "@tailwindcss/forms";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d2b25",
        muted: "#77827c",
        canvas: "#f6f7f5",
        line: "#e8ebe7",
        forest: "#1d6b50",
        mint: "#e8f4ed",
        peach: "#fff1e9",
      },
      fontFamily: {
        sans: ["DM Sans", "sans-serif"],
        display: ["Manrope", "sans-serif"],
      },
      boxShadow: {
        card: "0 2px 12px rgba(30, 48, 39, .035), 0 1px 2px rgba(30, 48, 39, .025)",
      },
    },
  },
  plugins: [forms],
};
