module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui"],
        body: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui"],
      },
      colors: {
        slateBlue: {
          50: "#f3f5ff",
          100: "#e6e9ff",
          200: "#c7ceff",
          300: "#a2adff",
          400: "#7a88ff",
          500: "#5969f1",
          600: "#4a54d6",
          700: "#3f46ad",
          800: "#343a88",
          900: "#2b2f6b"
        },
        sand: {
          50: "#fbf7f1",
          100: "#f3eadc",
          200: "#e7d3b2",
          300: "#d9b584",
          400: "#c89457",
          500: "#b47a3a",
          600: "#985f2d",
          700: "#7b4724",
          800: "#633920",
          900: "#512f1c"
        }
      }
    }
  },
  plugins: []
};
