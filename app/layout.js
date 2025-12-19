import './globals.css';

export const metadata = {
    title: 'Vectaix AI',
    description: 'Experience the next generation of AI with Gemini 3 Pro, Flash, and Image models.',
    manifest: '/manifest.json', // Next.js generates this from app/manifest.js but standard path is used
};

export const viewport = {
    themeColor: '#050507',
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false, // Prevent zooming on inputs in iOS
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
            </head>
            <body>
                <div className="main-layout h-full">
                    {children}
                </div>
            </body>
        </html>
    );
}
