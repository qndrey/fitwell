// A simple front and back body drawing for showing which muscles an exercise works. Original shapes, not taken from
// any library. Coordinates are on a 100 × 200 canvas; `mirror` regions are given for the left half of the picture and
// repeated flipped for the right half. Pure data: the view turns it into SVG.

export interface Region {
  /** The library muscle name this region stands for. */
  muscle: string;
  d: string;
  mirror: boolean;
}

export const BODY_WIDTH = 100;
export const BODY_HEIGHT = 200;

/** The silhouette parts, drawn faintly behind the muscles. */
export const SILHOUETTE: { d: string; mirror: boolean }[] = [
  { d: 'M50 4 C44 4 41 9 41 14 C41 20 45 24 50 24 C55 24 59 20 59 14 C59 9 56 4 50 4 Z', mirror: false },
  { d: 'M44 23 L56 23 L57 32 L43 32 Z', mirror: false },
  { d: 'M43 31 L37 34 C30 35 25 40 24 48 L23 72 L22 98 L28 100 L31 74 L33 58 L35 94 L33 104 L36 142 L37 190 L46 190 L48 150 L50 118 L50 31 Z', mirror: true },
];

const FRONT: Region[] = [
  { muscle: 'neck', d: 'M45 24 L55 24 L56 31 L44 31 Z', mirror: false },
  { muscle: 'traps', d: 'M44 31 L34 36 L38 41 L45 35 Z', mirror: true },
  { muscle: 'shoulders', d: 'M33 35 C27 36 24 41 24 48 L30 51 C31 45 34 42 37 41 Z', mirror: true },
  { muscle: 'chest', d: 'M37 41 L49 39 L49 57 C43 59 36 56 34 50 C34 46 35 43 37 41 Z', mirror: true },
  { muscle: 'biceps', d: 'M24 50 L30 52 L30 70 L25 69 C23 63 23 56 24 50 Z', mirror: true },
  { muscle: 'forearms', d: 'M25 71 L30 72 L29 98 L23 96 C23 87 24 79 25 71 Z', mirror: true },
  { muscle: 'abdominals', d: 'M42 59 L58 59 L57 90 C54 94 46 94 43 90 Z M35 60 L41 59 L42 89 L37 86 C35 78 34 68 35 60 Z', mirror: false },
  { muscle: 'abductors', d: 'M33 92 L37 94 L36 112 L32 108 Z', mirror: true },
  { muscle: 'quadriceps', d: 'M37 96 L48 96 L48 140 C44 144 40 143 38 140 C36 128 35 112 37 96 Z', mirror: true },
  { muscle: 'adductors', d: 'M48 100 L50 100 L50 126 C48 129 46 127 46 123 Z', mirror: true },
  { muscle: 'calves', d: 'M38 146 L46 146 L45 186 L40 186 C38 172 37 158 38 146 Z', mirror: true },
];

const BACK: Region[] = [
  { muscle: 'neck', d: 'M45 24 L55 24 L56 31 L44 31 Z', mirror: false },
  { muscle: 'traps', d: 'M50 31 L44 31 L35 37 L44 52 L50 58 Z', mirror: true },
  { muscle: 'shoulders', d: 'M33 35 C27 36 24 41 24 48 L30 51 C31 45 34 42 37 41 Z', mirror: true },
  { muscle: 'middle back', d: 'M44 53 L50 59 L50 73 L45 73 Z', mirror: true },
  { muscle: 'lats', d: 'M35 45 L43 55 L44 75 L38 74 C34 66 33 54 35 45 Z', mirror: true },
  { muscle: 'lower back', d: 'M45 76 L50 76 L50 91 L46 91 Z', mirror: true },
  { muscle: 'triceps', d: 'M24 50 L30 52 L30 70 L25 69 C23 63 23 56 24 50 Z', mirror: true },
  { muscle: 'forearms', d: 'M25 71 L30 72 L29 98 L23 96 C23 87 24 79 25 71 Z', mirror: true },
  { muscle: 'abductors', d: 'M33 90 L37 92 L37 106 L33 102 Z', mirror: true },
  { muscle: 'glutes', d: 'M37 92 L50 92 L50 109 C44 113 39 111 37 105 Z', mirror: true },
  { muscle: 'hamstrings', d: 'M37 111 L49 111 L48 142 C44 145 40 144 38 141 C36 130 36 120 37 111 Z', mirror: true },
  { muscle: 'calves', d: 'M37 146 L47 146 L45 185 L40 185 C37 172 36 158 37 146 Z', mirror: true },
];

export const BODY_VIEWS: Record<'front' | 'back', Region[]> = { front: FRONT, back: BACK };

/** Muscles of the library that appear on at least one side of the drawing. */
export const DRAWN_MUSCLES = [...new Set([...FRONT, ...BACK].map((r) => r.muscle))];
