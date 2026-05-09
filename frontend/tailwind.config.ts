import type { Config } from "tailwindcss";

/**
 * All theme-sensitive colors are CSS variables defined in
 * `app/globals.css` (under `:root[data-theme="dark"|"light"]`). Tailwind
 * utilities consume the matching `--<name>-rgb` triplet via
 * `rgb(var(--<name>-rgb) / <alpha-value>)`, which means opacity modifiers
 * like `bg-bg-1/80`, `border-primary/40`, `text-up/30` keep working
 * across themes.
 */
function token(name: string): string {
  return `rgb(var(--${name}-rgb) / <alpha-value>)`;
}

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: token("bg-0"),
          1: token("bg-1"),
          2: token("bg-2"),
          3: token("bg-3"),
          4: token("bg-4"),
        },
        line: {
          DEFAULT: token("line"),
          soft: token("line-soft"),
          strong: token("line-strong"),
        },
        ink: {
          0: token("ink-0"),
          1: token("ink-1"),
          2: token("ink-2"),
          3: token("ink-3"),
        },
        accent: {
          DEFAULT: token("accent"),
          dim: token("accent-dim"),
          glow: token("accent-glow"),
        },
        primary: {
          DEFAULT: token("primary"),
          dim: token("primary-dim"),
          glow: token("primary-glow"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          dim: token("secondary-dim"),
          glow: token("secondary-glow"),
        },
        up: {
          DEFAULT: token("up"),
          dim: token("up-dim"),
          glow: token("up-glow"),
        },
        down: {
          DEFAULT: token("down"),
          dim: token("down-dim"),
          glow: token("down-glow"),
        },
        flat: {
          DEFAULT: token("flat"),
        },
      },
      fontFamily: {
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
          "0 0 0 1px rgb(var(--line-rgb) / 0.7), 0 1px 0 0 rgba(255, 255, 255, 0.02) inset",
        glow: "0 0 24px rgb(var(--primary-rgb) / 0.25)",
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
        // flash-up / flash-down keyframes live in globals.css so they can use
        // CSS variables (theme-aware).
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
          "linear-gradient(to right, rgb(var(--line-rgb) / 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--line-rgb) / 0.35) 1px, transparent 1px)",
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
