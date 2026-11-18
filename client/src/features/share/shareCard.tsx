import { ImageResponse } from 'next/og';

// Square because WhatsApp crops link previews to a centered square.
export const SHARE_IMAGE_SIZE = { width: 1200, height: 1200 };

const BG = '#121317';
const WHITE = '#ffffff';
const ACCENT = '#b84dff';

export function renderShareImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: BG,
      }}
    >
      <svg width={720} height={720} viewBox="0 0 64 64">
        <path
          fill="none"
          stroke={WHITE}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 20v-6a4 4 0 0 1 4-4h8M47 10h8a4 4 0 0 1 4 4v6M59 40v6a4 4 0 0 1-4 4h-8M17 50H9a4 4 0 0 1-4-4v-6"
        />
        <path
          fill={ACCENT}
          d="M27 8h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-3.5L30 23.5V20h-3a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z"
        />
        <circle fill={WHITE} cx="20.5" cy="29" r="5.6" />
        <circle fill={WHITE} cx="43.5" cy="29" r="5.6" />
        <path fill={WHITE} d="M10 47c0-6.6 4.7-10.8 10.5-10.8S31 40.4 31 47z" />
        <path fill={WHITE} d="M33 47c0-6.6 4.7-10.8 10.5-10.8S54 40.4 54 47z" />
      </svg>
    </div>,
    SHARE_IMAGE_SIZE,
  );
}
