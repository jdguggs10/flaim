import { ImageResponse } from 'next/og'

export const alt = 'Flaim Fantasy'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || 'https://flaim.app'

  return new ImageResponse(
    (
      <div
        style={{
          background: '#171717',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          padding: '60px',
          position: 'relative',
        }}
      >
        <img
          src={`${baseUrl}/flaim-mark-hero-dark.png`}
          width={100}
          height={100}
          style={{ marginBottom: '32px' }}
        />
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: '#f5f5f5',
            letterSpacing: '-2px',
            marginBottom: '16px',
          }}
        >
          Flaim
        </div>
        <div
          style={{
            fontSize: 32,
            color: '#a3a3a3',
            textAlign: 'center',
          }}
        >
          Read-Only Fantasy League Analysis
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            right: '60px',
            fontSize: 20,
            color: '#525252',
          }}
        >
          flaim.app
        </div>
      </div>
    ),
    { ...size }
  )
}
