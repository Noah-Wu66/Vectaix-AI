import { ImageResponse } from 'next/og';

export const runtime = 'edge';

function Icon({ size }) {
    const starSize = Math.round(size * 0.62);

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #6d28d9 0%, #0ea5e9 100%)',
            }}
        >
            <svg
                width={starSize}
                height={starSize}
                viewBox="0 0 32 32"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M16 6 L19 13 L26 16 L19 19 L16 26 L13 19 L6 16 L13 13 Z"
                    fill="#ffffff"
                />
            </svg>
        </div>
    );
}

export function GET() {
    const size = 192;

    return new ImageResponse(<Icon size={size} />, {
        width: size,
        height: size,
    });
}


