/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#1a2233",
          soft: "#3a4356",
          mut: "#69748a",
          faint: "#9aa4b6",
        },
        brand: {
          50: "#fff6e8",
          100: "#ffe7c2",
          300: "#f9c266",
          500: "#f59c21",
          600: "#db8410",
          700: "#b56a08",
        },
        navy: {
          DEFAULT: "#051627",
          600: "#0c2740",
          500: "#123454",
        },
        panel: "#051627",
        panel2: "#0c2740",
        line: "#e6eaf2",
        bg: "#f4f6fa",
        up: "#0a8f5b",
        down: "#d63b3b",
        warn: "#e08a1e",
      },
      fontFamily: {
        sans: ["Montserrat", "Gotham Pro", "Segoe UI", "Roboto", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.04)",
        pop: "0 10px 30px rgba(16,24,40,.14)",
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
  plugins: [],
};
