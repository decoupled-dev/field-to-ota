/** @type {import('tailwindcss').Config} */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "16px"],
        xs: ["12px", "16px"],
        sm: ["14px", "20px"],
        base: ["14px", "20px"],
      },
      borderRadius: { DEFAULT: "4px", sm: "3px", md: "6px", lg: "8px" },
      boxShadow: {
        card: "0 1px 1px hsl(var(--shadow) / 0.25), 0 0 1px hsl(var(--shadow) / 0.31)",
        overlay: "0 8px 12px hsl(var(--shadow) / 0.15), 0 0 1px hsl(var(--shadow) / 0.31)",
      },
      colors: {
        bg: v("bg"),
        surface: v("surface"),
        raised: v("raised"),
        subtle: v("subtle"),
        border: v("border"),
        strong: v("strong"),
        fg: v("fg"),
        muted: v("muted"),
        faint: v("faint"),
        accent: v("accent"),
        "accent-fg": v("accent-fg"),
        ok: v("ok"),
        run: v("run"),
        warn: v("warn"),
        bad: v("bad"),
        info: v("info"),
        nav: v("nav"),
        "nav-fg": v("nav-fg"),
        "nav-muted": v("nav-muted"),
        "nav-hover": v("nav-hover"),
      },
      keyframes: {
        pulseRing: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        flow: { to: { strokeDashoffset: "-24" } },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        pulseSoft: "pulseRing 1.6s ease-in-out infinite",
        flow: "flow 0.9s linear infinite",
        sweep: "sweep 1.8s ease-in-out infinite",
        spinSlow: "spin 3s linear infinite",
      },
    },
  },
  plugins: [],
};
