/** @type {import('tailwindcss').Config} */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", "14px"],
        xs: ["11.5px", "16px"],
        sm: ["13px", "20px"],
        base: ["14px", "22px"],
      },
      borderRadius: { DEFAULT: "3px", sm: "2px", md: "4px", lg: "5px" },
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
