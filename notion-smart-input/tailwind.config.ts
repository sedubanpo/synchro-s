import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        neon: "0 0 40px rgba(56, 189, 248, 0.24), 0 0 90px rgba(124, 58, 237, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
