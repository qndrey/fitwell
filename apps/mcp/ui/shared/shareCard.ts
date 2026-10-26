// Draws a share card (F4) on a canvas in the person's own view. The server never renders, stores or posts it.
import type { Celebration } from '../../src/analytics/celebrationTypes';
import { cardText, FORMATS, type CardContent, type CardOptions } from './shareCardText';

const PALETTE = {
  light: { bg: '#faf8f5', text: '#1f1d1a', muted: '#6b655d', line: '#ddd6cc' },
  dark: { bg: '#1b1a18', text: '#f2efe9', muted: '#b2aba1', line: '#3a3733' },
} as const;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws the card at full size (1080 wide); the view shows it scaled down, so the preview is the saved image. */
export function drawCard(canvas: HTMLCanvasElement, c: Celebration, o: CardOptions): CardContent {
  const { width, height } = FORMATS[o.format];
  canvas.width = width;
  canvas.height = height;
  const content = cardText(c, o);
  const ctx = canvas.getContext('2d')!;
  const p = PALETTE[o.theme];
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // The story format keeps clear of the bars the apps draw over its top and bottom.
  const top = o.format === 'story' ? 330 : 150;
  const bottom = height - (o.format === 'story' ? 330 : 120);
  const radius = 230;
  const cy = top + radius + (o.format === 'square' ? 0 : 40);
  const cx = width / 2;

  ctx.lineWidth = 16;
  ctx.strokeStyle = p.line;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = p.text;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();

  ctx.fillStyle = p.text;
  if (content.big === null) {
    ctx.lineWidth = 22;
    ctx.strokeStyle = p.text;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy + 5);
    ctx.lineTo(cx - 20, cy + 65);
    ctx.lineTo(cx + 85, cy - 60);
    ctx.stroke();
  } else {
    ctx.font = `600 ${content.big.length > 3 ? 150 : 200}px ${FONT}`;
    ctx.fillText(content.big, cx, cy + (content.big.length > 3 ? 52 : 70));
  }

  let y = cy + radius + 130;
  ctx.font = `600 78px ${FONT}`;
  for (const line of wrap(ctx, content.title, width - 200)) {
    ctx.fillText(line, cx, y);
    y += 92;
  }
  ctx.fillStyle = p.muted;
  if (content.detail) {
    ctx.font = `400 44px ${FONT}`;
    y += 10;
    for (const line of wrap(ctx, content.detail, width - 240)) {
      ctx.fillText(line, cx, y);
      y += 58;
    }
  }
  ctx.font = `400 46px ${FONT}`;
  y += 24;
  for (const line of content.lines) {
    if (y > bottom - 90) break;
    ctx.fillText(line, cx, y);
    y += 64;
  }

  if (content.name) {
    ctx.fillStyle = p.text;
    ctx.font = `600 50px ${FONT}`;
    ctx.fillText(content.name, cx, bottom - 40);
  }
  if (content.brand) {
    ctx.fillStyle = p.muted;
    ctx.font = `500 36px ${FONT}`;
    ctx.fillText(content.brand, cx, bottom + (content.name ? 20 : 0));
  }
  return content;
}
