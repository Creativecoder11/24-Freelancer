import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/site';

export const alt = `${SITE_NAME} — earn from small online tasks, or get work done`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link preview card (Facebook, WhatsApp, LinkedIn, X, Slack) for every page without its own image. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0F1B2D', color: '#FFFFFF', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: '#004488', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, fontWeight: 800 }}>24</div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5 }}>Turn spare minutes into verified earnings.</div>
          <div style={{ fontSize: 30, color: '#B8C4D6', lineHeight: 1.35 }}>Small online tasks with the reward, time and proof shown up front. Employers pay only for approved work.</div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 26, color: '#8FB4E0' }}>
          <span>24freelancing.com</span>
          <span>·</span>
          <span>Withdraw to bKash, Nagad, Rocket or USDT</span>
        </div>
      </div>
    ),
    size,
  );
}
