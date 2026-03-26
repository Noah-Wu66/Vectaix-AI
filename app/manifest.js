export default function manifest() {
    return {
        name: 'Vectaix AI',
        short_name: 'Vectaix AI',
        description: 'Open-source AI workspace with official OpenAI, Anthropic, Gemini, DeepSeek, Seed, and OpenRouter-routed third-party models.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#f8fafc',
        icons: [
            {
                src: '/icon',
                sizes: '32x32',
                type: 'image/png',
            },
            {
                src: '/apple-icon',
                sizes: '180x180',
                type: 'image/png',
            },
        ],
    };
}





