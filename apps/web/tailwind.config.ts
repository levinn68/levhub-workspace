import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: '#05070d',
        surface: '#0b101d',
        accent: {
          DEFAULT: '#38bdf8',
          indigo: '#818cf8',
        },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        glow: '0 0 24px rgba(56, 189, 248, 0.16)',
      },
    },
  },
  plugins: [],
};

export default config;
