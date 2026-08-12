/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Design tokens sampled from updated_UI/*.png. Not pixel-exact —
        // §20 only requires consistent design-language adherence.
        navy: {
          DEFAULT: '#0B1A2C',
          light: '#16283F',
          lighter: '#22384F',
        },
        accent: {
          DEFAULT: '#F2A93E',
          hover: '#E0972B',
          tint: '#FEF3C7',
        },
        surface: '#F4F5F7',
        card: '#FFFFFF',
        border: '#E7E9ED',
        ink: {
          DEFAULT: '#111827',
          muted: '#6B7280',
          faint: '#9CA3AF',
        },
        sidebar: {
          text: '#C4CEDB',
          muted: '#7C8AA0',
        },
        status: {
          green: { DEFAULT: '#16A34A', bg: '#DCFCE7', text: '#15803D' },
          blue: { DEFAULT: '#2563EB', bg: '#DBEAFE', text: '#1D4ED8' },
          amber: { DEFAULT: '#D97706', bg: '#FEF3C7', text: '#92400E' },
          red: { DEFAULT: '#DC2626', bg: '#FEE2E2', text: '#B91C1C' },
          gray: { DEFAULT: '#9CA3AF', bg: '#F3F4F6', text: '#6B7280' },
        },
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
      },
    },
  },
  plugins: [],
};
