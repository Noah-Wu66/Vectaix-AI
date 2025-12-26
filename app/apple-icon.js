import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export const size = {
    width: 180,
    height: 180,
};

export const contentType = 'image/png';

export default function AppleIcon() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #6d28d9 0%, #0ea5e9 100%)',
                    borderRadius: 48,
                }}
            >
                <svg width="120" height="120" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 6 L19 13 L26 16 L19 19 L16 26 L13 19 L6 16 L13 13 Z" fill="white" />
                </svg>
            </div>
        ),
        size
    );
}

