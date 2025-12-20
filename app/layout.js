import './globals.css';

export const metadata = {
    title: 'Vectaix AI',
    description: 'Experience the next generation of AI with Gemini 3 Pro, Flash, and Image models.',
    manifest: '/manifest.webmanifest',
};

export const viewport = {
    themeColor: '#f8fafc',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    viewportFit: 'cover',
    userScalable: false, // Prevent zooming on inputs in iOS
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" style={{ backgroundColor: '#ffffff' }}>
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
                <meta name="mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-title" content="Vectaix AI" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <link rel="apple-touch-icon" href="/apple-touch-icon" sizes="180x180" />
            </head>
            <body>
                <div className="main-layout h-full">
                    {children}
                </div>
            </body>
        </html>
    );
}
