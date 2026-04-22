/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0a0f1e',
          800: '#0d1326',
          700: '#141b2d',
          600: '#1a2340',
          500: '#1e2a4a',
          400: '#253257',
        },
        accent: {
          red: '#ff3b3b',
          amber: '#f59e0b',
          teal: '#2dd4bf',
          blue: '#3b82f6',
          purple: '#8b5cf6',
        },
        glass: {
          DEFAULT: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.1)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-red': 'pulse-red 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-amber': 'pulse-amber 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'blink': 'blink 1.5s step-end infinite',
        'countdown': 'countdown linear 1s',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 0 0 rgba(255, 59, 59, 0.4)' },
          '50%': { opacity: 0.8, boxShadow: '0 0 0 10px rgba(255, 59, 59, 0)' },
        },
        'pulse-amber': {
          '0%, 100%': { opacity: 1, boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.4)' },
          '50%': { opacity: 0.8, boxShadow: '0 0 0 10px rgba(245, 158, 11, 0)' },
        },
        fadeIn: {
          '0%': { opacity: 0, transform: 'translateY(-8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: 0, transform: 'translateX(20px)' },
          '100%': { opacity: 1, transform: 'translateX(0)' },
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0 },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-red': '0 0 20px rgba(255, 59, 59, 0.3)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.3)',
        'glow-teal': '0 0 20px rgba(45, 212, 191, 0.3)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.37)',
      },
    },
  },
  plugins: [],
};
