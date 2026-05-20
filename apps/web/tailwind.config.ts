import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Graphite scale — keep for backward compat, mapped to new design values
        graphite: {
          950: "#0B0D10",  // page bg
          900: "#13151A",  // surface
          850: "#1A1D24",  // surface-2
          800: "#20232C",  // surface-3
          700: "#2A2D38",  // border
          600: "#363A48",  // border-2
          500: "#5E6478",  // text-3
          400: "#9AA0B4",  // text-2
          300: "#C8CDD9",
          200: "#E4E6EC",  // border light
          100: "#F1F3F7",  // text-1
          50:  "#F6F7F9",  // bg light
        },
        // Brand — orange accent, CTAs and active states only
        brand: {
          DEFAULT: "#FF6B35",
          hover:   "#E55A25",
          surface: "#1F1208",
          dim:     "#E55A25",
        },
        // Legacy aliases
        "brand-dim": "#E55A25",
        "brand-bg":  "#1F1208",
        // Status colors (dark defaults; light theme inherits via CSS vars)
        status: {
          "green-bg":     "#0C2818",
          "green-text":   "#34D058",
          "green-border": "#1F6B35",
          "yellow-bg":    "#221A04",
          "yellow-text":  "#D4A017",
          "yellow-border":"#7A5A08",
          "red-bg":       "#2A0D0D",
          "red-text":     "#F47067",
          "red-border":   "#7A1515",
          "blue-bg":      "#0A1F3D",
          "blue-text":    "#60A5FA",
          "blue-border":  "#1A4A8A",
          "neutral-bg":   "#1A1D24",
          "neutral-text": "#9AA0B4",
        },
      },
      borderRadius: {
        sm:      "5px",
        DEFAULT: "7px",
        lg:      "10px",
        xl:      "14px",
        full:    "9999px",
      },
      boxShadow: {
        card:        "0 1px 2px rgba(0,0,0,0.08)",
        float:       "0 8px 30px rgba(0,0,0,0.2)",
        focus:       "0 0 0 3px rgba(255,107,53,0.2)",
        sm:          "0 1px 3px rgba(0,0,0,0.35)",
        md:          "0 4px 12px rgba(0,0,0,0.4)",
        "focus-brand": "0 0 0 2px rgba(255,107,53,0.18)",
      },
      fontSize: {
        "2xs": ["10px",  { lineHeight: "14px" }],
        xs:    ["11px",  { lineHeight: "16px" }],
        sm:    ["12px",  { lineHeight: "18px" }],
        base:  ["13px",  { lineHeight: "20px" }],
        md:    ["14px",  { lineHeight: "20px" }],
        lg:    ["15px",  { lineHeight: "22px" }],
        xl:    ["18px",  { lineHeight: "26px" }],
        "2xl": ["22px",  { lineHeight: "30px" }],
        "3xl": ["28px",  { lineHeight: "36px" }],
      },
    },
  },
  plugins: [],
};

export default config;
