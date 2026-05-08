import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Base canvas — never pure black
        bg: {
          0: "#0d1117", // primary canvas
          1: "#11161f", // panel
          2: "#161c27", // raised
          3: "#1a1a2e", // accent panel (per spec)
          4: "#222a38", // subtle hover
        },
        line: {
          DEFAULT: "#222a38",
          soft: "#1b2230",
          strong: "#2d3a4e",
        },
        ink: {
          0: "#e6edf3", // primary text
          1: "#a8b3c1", // secondary
          2: "#6e7a8a", // tertiary / labels
          3: "#4a5363", // muted
        },
        // Brand
        accent: {
          DEFAULT: "#ecad0a", // accent yellow
          dim: "#b8870a",
          glow: "#fbd34d",
        },
        primary: {
          DEFAULT: "#209dd7", // blue primary
          dim: "#1a7faf",
          glow: "#62c2ee",
        },
        secondary: {
          DEFAULT: "#753991", // purple secondary
          dim: "#5a2c70",
          glow: "#a060c0",
        },
        // Market signals
        up: {
          DEFAULT: "#26d086",
          dim: "#1a8857",
          glow: "rgba(38, 208, 134, 0.18)",
        },
        down: {
          DEFAULT: "#f0506e",
          dim: "#a3354b",
          glow: "rgba(240, 80, 110, 0.18)",
        },
        flat: {
          DEFAULT: "#6e7a8a",
        },
      },
      fontFamily: {
        // Distinctive type stack — not generic Inter
        display: [
          "var(--font-display)",
          "'Fraunces'",
          "'Source Serif Pro'",
          "Georgia",
          "serif",
        ],
        sans: [
          "var(--font-sans)",
          "'IBM Plex Sans'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "'JetBrains Mono'",
          "'IBM Plex Mono'",
          "ui-monospace",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.875rem", letterSpacing: "0.04em" }],
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.125rem" }],
        tabular: ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "0" }],
      },
      letterSpacing: {
        terminal: "0.02em",
        eyebrow: "0.18em",
      },
      borderRadius: {
        sharp: "2px",
        panel: "4px",
      },
      boxShadow: {
        panel:
          "0 0 0 1px rgba(34, 42, 56, 0.7), 0 1px 0 0 rgba(255, 255, 255, 0.02) inset",
        glow: "0 0 24px rgba(32, 157, 215, 0.25)",
      },
      transitionDuration: {
        flash: "500ms",
      },
      animation: {
        "flash-up": "flash-up 500ms ease-out",
        "flash-down": "flash-down 500ms ease-out",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        "ticker-in": "ticker-in 220ms ease-out",
      },
      keyframes: {
        "flash-up": {
          "0%": { backgroundColor: "rgba(38, 208, 134, 0.32)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-down": {
          "0%": { backgroundColor: "rgba(240, 80, 110, 0.32)" },
          "100%": { backgroundColor: "transparent" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        "ticker-in": {
          "0%": { opacity: "0", transform: "translateY(2px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(34, 42, 56, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 42, 56, 0.35) 1px, transparent 1px)",
        "scanline":
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 3px)",
      },
      backgroundSize: {
        "grid-cell": "32px 32px",
      },
    },
  },
  plugins: [],
};

export default config;
