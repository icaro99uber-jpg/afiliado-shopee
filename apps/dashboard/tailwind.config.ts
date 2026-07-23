import type { Config } from 'tailwindcss';
export default { darkMode: ['class'], content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { borderRadius: { lg: '0.75rem' } } }, plugins: [require('tailwindcss-animate')] } satisfies Config;
