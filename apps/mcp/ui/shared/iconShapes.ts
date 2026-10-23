// The icon shapes of the views: SVG parts on a 24 px grid, drawn with stroke in currentColor. Plain data (no DOM) so tests can read it; icons.ts draws them.
export type Shape = [tag: string, attrs: Record<string, string | number>];
const path = (d: string): Shape => ['path', { d }];
const poly = (points: string): Shape => ['polyline', { points }];
const line = (x1: number, y1: number, x2: number, y2: number): Shape => ['line', { x1, y1, x2, y2 }];
const circle = (cx: number, cy: number, r: number): Shape => ['circle', { cx, cy, r }];
const rect = (x: number, y: number, width: number, height: number, rx = 0): Shape => ['rect', { x, y, width, height, rx }];

export const ICONS = {
  'chevron-left': [path('m15 18-6-6 6-6')],
  'chevron-right': [path('m9 18 6-6-6-6')],
  'chevron-down': [path('m6 9 6 6 6-6')],
  'chevron-up': [path('m18 15-6-6-6 6')],
  x: [path('M18 6 6 18'), path('m6 6 12 12')],
  plus: [path('M5 12h14'), path('M12 5v14')],
  minus: [path('M5 12h14')],
  check: [path('M20 6 9 17l-5-5')],
  circle: [circle(12, 12, 10)],
  'check-circle': [circle(12, 12, 10), path('m9 12 2 2 4-4')],
  diamond: [path('M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z')],
  pencil: [path('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), path('m15 5 4 4')],
  swap: [path('M8 3 4 7l4 4'), path('M4 7h16'), path('m16 21 4-4-4-4'), path('M20 17H4')],
  'book-open': [path('M12 7v14'), path('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z')],
  'skip-forward': [poly('5 4 15 12 5 20 5 4'), line(19, 5, 19, 19)],
  undo: [path('M9 14 4 9l5-5'), path('M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11')],
  'rotate-cw': [path('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'), path('M21 3v5h-5')],
  crosshair: [circle(12, 12, 10), line(22, 12, 18, 12), line(6, 12, 2, 12), line(12, 6, 12, 2), line(12, 22, 12, 18)],
  pause: [rect(14, 4, 4, 16, 1), rect(6, 4, 4, 16, 1)],
  play: [poly('6 3 20 12 6 21 6 3')],
  eye: [path('M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'), circle(12, 12, 3)],
  'eye-off': [
    path('M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49'),
    path('M14.084 14.158a3 3 0 0 1-4.242-4.242'),
    path('M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143'),
    path('m2 2 20 20'),
  ],
  bars: [path('M3 3v16a2 2 0 0 0 2 2h16'), path('M18 17V9'), path('M13 17V5'), path('M8 17v-3')],
  clock: [circle(12, 12, 10), poly('12 6 12 12 16 14')],
  'external-link': [path('M15 3h6v6'), path('M10 14 21 3'), path('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')],
  message: [path('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')],
  calendar: [rect(3, 4, 18, 18, 2), path('M16 2v4'), path('M8 2v4'), path('M3 10h18')],
  // Card tabs of the dashboard and the review.
  weight: [circle(12, 5, 3), path('M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.5 8z')],
  utensils: [path('M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2'), path('M7 2v20'), path('M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7')],
  flame: [path('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z')],
  dumbbell: [path('M6.5 6.5v11'), path('M17.5 6.5v11'), path('M3.5 9v6'), path('M20.5 9v6'), path('M6.5 12h11')],
  'trending-up': [poly('22 7 13.5 15.5 8.5 10.5 2 17'), poly('16 7 22 7 22 13')],
  'list-check': [path('m3 17 2 2 4-4'), path('m3 7 2 2 4-4'), path('M13 6h8'), path('M13 12h8'), path('M13 18h8')],
  ruler: [
    path('M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z'),
    path('m14.5 12.5 2-2'),
    path('m11.5 9.5 2-2'),
    path('m8.5 6.5 2-2'),
    path('m17.5 15.5 2-2'),
  ],
  'thumbs-up': [path('M7 10v12'), path('M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z')],
  'heart-pulse': [
    path('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'),
    path('M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'),
  ],
  clipboard: [rect(8, 2, 8, 4, 1), path('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2')],
  lightbulb: [path('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), path('M9 18h6'), path('M10 22h4')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
