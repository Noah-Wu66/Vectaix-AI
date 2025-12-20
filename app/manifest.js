export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix',
        description: 'Next-gen AI assistant powered by Gemini 3',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#f8fafc',
        icons: [
            {
                src: '/pwa/icon-192',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/pwa/icon-512',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
            },
        ],
    }
}
