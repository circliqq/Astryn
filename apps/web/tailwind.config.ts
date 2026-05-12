import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      colors: {
        // Surface scale
        graphite: {
          950: "#0C0E12",   // page background
          900: "#111318",   // card / panel
          800: "#181B21",   // input / code / table row alt
          700: "#252830",   // border default
          600: "#333740",   // border strong / focused
          500: "#555B6A",   // text muted
          400: "#8B90A0",   // text secondary
          300: "#C2C7D4",   // text moderate
          200: "#E0E3EA",   // text strong
          100: "#F0F2F5",   // text primary
        },
        // Brand — single accent colour
        brand:       "#FF6B35",
        "brand-dim": "#C84E1E",
        "brand-bg":  "#1C1209",   // very dark orange tint for bg highlights
        // Status colours (bg / text pairs)
        status: {
          "green-bg":    "#0D2B17",
          "green-text":  "#3FB950",
          "green-border":"#22863A",
          "yellow-bg":   "#2B1D03",
          "yellow-text": "#D29922",
          "yellow-border":"#9E6A03",
          "red-bg":      "#2D0F0F",
          "red-text":    "#F85149",
          "red-border":  "#8B1A1A",
          "blue-bg":     "#0D1F40",
          "blue-text":   "#58A6FF",
          "blue-border": "#1158AE",
          "neutral-bg":  "#1E2028",
          "neutral-text":"#8B90A0",
        }
      },
      boxShadow: {
        // Only use real depth shadows — no coloured glows
        "sm": "0 1px 3px rgba(0,0,0,0.35)",
        "md": "0 4px 12px rgba(0,0,0,0.4)",
        // Input focus ring — very subtle brand tint
        "focus-brand": "0 0 0 2px rgba(255,107,53,0.18)",
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs:    ["11px", { lineHeight: "16px" }],
        sm:    ["12px", { lineHeight: "18px" }],
        base:  ["13px", { lineHeight: "20px" }],
        md:    ["14px", { lineHeight: "20px" }],
        lg:    ["15px", { lineHeight: "22px" }],
        xl:    ["18px", { lineHeight: "26px" }],
        "2xl": ["22px", { lineHeight: "30px" }],
        "3xl": ["28px", { lineHeight: "36px" }],
      }
    }
  },
  plugins: []
};

export default config;
