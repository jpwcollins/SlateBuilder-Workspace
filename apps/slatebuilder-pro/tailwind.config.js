module.exports = {
  // packages/core holds some class names too (urgencyChipClasses).
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/core/src/**/*.ts"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui"],
        body: ["'IBM Plex Sans'", "ui-sans-serif", "system-ui"],
      },
      colors: {
        slateBlue: {
          50: "#eff4ff",
          100: "#dce6fd",
          200: "#c0d2fb",
          300: "#94b2f6",
          400: "#638bef",
          500: "#3f68e6",
          600: "#2b4fd6",
          700: "#2440b4",
          800: "#22368f",
          900: "#172447"
        },
        sand: {
          50: "#f7f8fa",
          100: "#f0f2f5",
          200: "#e3e7ec",
          300: "#cdd3db",
          400: "#97a1ae",
          500: "#6b7584",
          600: "#4f5867",
          700: "#3a4351",
          800: "#29303b",
          900: "#1a1f27"
        }
      }
    }
  },
  plugins: []
};
