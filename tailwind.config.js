/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    darkMode: ['class', '.dark-mode'],
    theme: {
        extend: {
            colors: {
                primary: 'var(--primary)',
                'primary-hover': 'var(--primary-hover)',
            },
        },
    },
    plugins: [],
};
