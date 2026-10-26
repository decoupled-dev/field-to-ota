/** @type {import('tailwindcss').Config} */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: { xs: ["12px", "16px"], sm: ["13px", "20px"], base: ["14px", "22px"] },
      borderRadius: { DEFAULT: "6px", md: "6px", lg: "8px" },
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        subtle: v("subtle"),
        border: v("border"),
        fg: v("fg"),
        muted: v("muted"),
        accent: v("accent"),
        "accent-fg": v("accent-fg"),
        ok: v("ok"),
        run: v("run"),
        warn: v("warn"),
        bad: v("bad"),
      },
      keyframes: { pulseRing: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".45" } } },
      animation: { pulseSoft: "pulseRing 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
