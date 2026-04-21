/**
 * xHandle: tailwind.config module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

// tailwind.config.js
module.exports = {
  darkMode: 'class',                    // << enable class-based dark mode
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
