export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix AI',
        description: 'Experience the next generation of AI with Gemini 3 Pro, Flash, and Image models.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#f8fafc',
        icons: [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    };
}



