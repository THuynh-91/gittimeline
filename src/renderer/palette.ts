import { oklchToHex } from '@/model/color';

/** The single visual identity: ink stage, ivory spine, slate threads, sparse saturated human accents. */
export const PALETTE = {
  ink: '#07080c',
  inkLift: '#0d0f16',
  ivory: '#f4e9d2',
  slate: '#6f7d99',
  fog: '#a0aabe',
  fogText: '#bec6d6',
  text: '#e6e1d6',
  textDim: '#b5b1a8',
  accent: '#7fd6ff',
  warn: '#ffb070',
  merge: '#fff3dc',
  highContrast: {
    ivory: '#ffffff',
    slate: '#b8c2d6',
    text: '#ffffff',
  },
} as const;

/**
 * A muted structural colour per thread, so two branches running side by side are
 * never the same grey. Threads above the spine drift cool, below drift warm, and
 * each lane out shifts value. This encodes topology only: a contributor's colour
 * still travels through the path as a moving body and never repaints it.
 */
export function threadTint(side: number, lane: number, highContrast: boolean): string {
  if (side === 0) return highContrast ? PALETTE.highContrast.ivory : PALETTE.ivory;
  const hue = side < 0 ? 232 - Math.min(4, lane) * 16 : 44 + Math.min(4, lane) * 14;
  const l = (highContrast ? 0.78 : 0.63) - Math.min(3, lane) * 0.035;
  return oklchToHex(l, highContrast ? 0.05 : 0.042, hue);
}

export const GLYPH_PATHS: Record<string, (ctx: CanvasRenderingContext2D, r: number) => void> = {
  orb: (c, r) => {
    c.arc(0, 0, r, 0, Math.PI * 2);
  },
  diamond: (c, r) => {
    c.moveTo(0, -r * 1.15);
    c.lineTo(r * 1.15, 0);
    c.lineTo(0, r * 1.15);
    c.lineTo(-r * 1.15, 0);
    c.closePath();
  },
  triangle: (c, r) => {
    c.moveTo(0, -r * 1.25);
    c.lineTo(r * 1.1, r * 0.75);
    c.lineTo(-r * 1.1, r * 0.75);
    c.closePath();
  },
  square: (c, r) => {
    c.rect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
  },
  ring: (c, r) => {
    c.arc(0, 0, r * 1.1, 0, Math.PI * 2);
    c.moveTo(r * 0.5, 0);
    c.arc(0, 0, r * 0.5, 0, Math.PI * 2, true);
  },
  star: (c, r) => {
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r * 1.3 : r * 0.55;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  },
  hex: (c, r) => {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const x = Math.cos(a) * r * 1.1;
      const y = Math.sin(a) * r * 1.1;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  },
  cross: (c, r) => {
    const w = r * 0.42;
    const l = r * 1.2;
    c.rect(-w, -l, w * 2, l * 2);
    c.rect(-l, -w, l * 2, w * 2);
  },
};
