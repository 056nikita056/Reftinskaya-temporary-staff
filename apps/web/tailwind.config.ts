import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        refYellow: "#f6c500",
        refGreen: "#007a45",
        refDark: "#202020"
      },
      boxShadow: {
        panel: "0 12px 30px rgba(0,0,0,0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
