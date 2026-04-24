import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-left": {
          "0%": { transform: "translateX(-24px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 20px rgba(34,211,238,0.25), 0 0 40px rgba(34,211,238,0.08)",
          },
          "50%": {
            boxShadow:
              "0 0 32px rgba(34,211,238,0.5), 0 0 64px rgba(34,211,238,0.18)",
          },
        },
        "dot-bounce": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-5px)", opacity: "1" },
        },
        "scan-line": {
          "0%": { top: "0%", opacity: "0" },
          "5%": { opacity: "1" },
          "95%": { opacity: "1" },
          "100%": { top: "100%", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 250ms ease-out",
        "slide-in-right": "slide-in-right 320ms cubic-bezier(0.32,0.72,0,1)",
        "slide-in-left": "slide-in-left 320ms cubic-bezier(0.32,0.72,0,1)",
        "glow-pulse": "glow-pulse 2.2s ease-in-out infinite",
        "dot-bounce": "dot-bounce 1.4s ease-in-out infinite",
        "scan-line": "scan-line 2s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
