export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix',
        description: 'Next-gen AI assistant powered by Gemini 3',
        start_url: '/',
        display: 'standalone',
        background_color: '#050507',
        theme_color: '#050507',
        icons: [
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    }
}
