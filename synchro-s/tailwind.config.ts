import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        synchro: {
          navy: "#0f172a",
          blue: "#2563eb",
          mint: "#14b8a6",
          cream: "#f8fafc"
        }
      }
    }
  },
  plugins: []
};

export default config;
