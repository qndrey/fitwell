import type { Pose, Template } from './figure';

// Angles are in degrees: 0 = down, 90 = forward, 180 = up, 270 = back (see figure.ts).
// Angles blend in a straight line between poses, so a joint that turns past "down" is written as a negative number.
const stand: Pose = { torso: 180, uarm: 0, farm: 0, thigh: 0, shin: 0 };
const sit = { torso: 180, thigh: 90, shin: 0 } as const;
/** On the back, head to the left, knees bent and feet flat. */
const supine = { torso: 270, head: 262, thigh: 130, shin: 47 } as const;
/** On the back with straight legs. */
const flat = { torso: 270, head: 266, thigh: 90, shin: 90, foot: 180 } as const;
/** Straight-arm plank with the hands under the shoulders and the body in one line. */
const plankHigh = { torso: 109.8, uarm: 0, farm: 0, thigh: 289.8, shin: 289.8, foot: 0 } as const;

/** Motions we can draw. Each is a start and an end pose (and sometimes poses in between); the app plays the figure between them. */
export const TEMPLATES: Record<string, Template> = {
  // ── Squats and lunges ────────────────────────────────────────────
  'squat-bodyweight': {
    trace: 'hip',
    start: { ...stand, uarm: 90, farm: 90 },
    end: { torso: 145, uarm: 95, farm: 95, thigh: 95, shin: 330 },
  },
  'squat-barbell': {
    hold: 'barbell',
    trace: 'none',
    start: { ...stand, uarm: 350, farm: 190 },
    end: { torso: 145, uarm: 315, farm: 155, thigh: 95, shin: 330 },
  },
  'front-squat': {
    hold: 'barbell',
    trace: 'none',
    start: { ...stand, uarm: 95, farm: 245 },
    end: { torso: 162, uarm: 77, farm: 227, thigh: 100, shin: 328 },
  },
  'overhead-squat': {
    hold: 'barbell',
    trace: 'none',
    start: { ...stand, uarm: 182, farm: 182 },
    end: { torso: 148, uarm: 192, farm: 192, thigh: 98, shin: 328 },
  },
  'squat-goblet': {
    hold: 'dumbbell',
    trace: 'none',
    start: { ...stand, uarm: 20, farm: 160 },
    end: { torso: 162, uarm: 5, farm: 145, thigh: 98, shin: 332 },
  },
  'jump-squat': {
    trace: 'hip',
    start: { torso: 145, uarm: -30, farm: -25, thigh: 95, shin: 330 },
    end: { ...stand, uarm: 135, farm: 140, foot: 25, rise: 6 },
  },
  lunge: {
    trace: 'hip',
    start: { ...stand, thigh2: 0, shin2: 0, foot2: 90 },
    end: { ...stand, thigh: 85, shin: 0, thigh2: -35, shin2: -90, foot2: -47 },
  },
  'step-up': {
    props: ['step'],
    trace: 'hip',
    start: { ...stand, thigh: 68.6, shin: 354.7, thigh2: 0, shin2: 0 },
    end: { ...stand, thigh2: 25, shin2: 330, rise: 9 },
  },

  // ── Hinges ───────────────────────────────────────────────────────
  deadlift: {
    thumb: 0,
    hold: 'barbell',
    start: { torso: 120, uarm: 0, farm: 0, thigh: 73, shin: 345 },
    end: stand,
  },
  'romanian-deadlift': {
    hold: 'barbell',
    start: stand,
    end: { torso: 100, uarm: 0, farm: 0, thigh: 12, shin: 355 },
  },
  'good-morning': {
    hold: 'barbell',
    trace: 'head',
    start: { ...stand, uarm: 350, farm: 190 },
    end: { torso: 100, uarm: 270, farm: 110, thigh: 12, shin: 355 },
  },
  'kettlebell-swing': {
    hold: 'kettlebell',
    start: { torso: 122, uarm: -20, farm: -28, thigh: 38, shin: 345 },
    end: { ...stand, uarm: 95, farm: 95 },
  },
  clean: {
    hold: 'barbell',
    start: { torso: 120, uarm: 0, farm: 0, thigh: 73, shin: 345 },
    via: [{ ...stand, torso: 185, foot: 40 }],
    end: { torso: 172, uarm: 100, farm: 245, thigh: 40, shin: 340 },
  },
  'hip-thrust': {
    hold: 'barbell',
    props: ['back-bench'],
    reach: { to: 'hip', bend: -1 },
    trace: 'hip',
    start: { torso: 245.4, head: 240, uarm: 0, farm: 0, thigh: 126.3, shin: 18.9 },
    end: { torso: 270, head: 262, uarm: 0, farm: 0, thigh: 94, shin: -0.8 },
  },
  'glute-bridge': {
    pin: 'shoulder',
    trace: 'hip',
    start: { ...supine, uarm: 90, farm: 90 },
    end: { torso: 292, head: 280, uarm: 90, farm: 90, thigh: 102, shin: 15 },
  },
  'back-extension': {
    props: ['hyper'],
    trace: 'head',
    start: { torso: 15, uarm: 185, farm: 25, thigh: 300, shin: 300, foot: 30 },
    end: { torso: 120, uarm: 290, farm: 130, thigh: 300, shin: 300, foot: 30 },
  },

  // ── Pushing ──────────────────────────────────────────────────────
  'bench-press': {
    hold: 'barbell',
    props: ['bench'],
    start: { torso: 270, head: 268, uarm: 80, farm: 170, thigh: 90, shin: 0 },
    end: { torso: 270, head: 268, uarm: 178, farm: 180, thigh: 90, shin: 0 },
  },
  'incline-press': {
    hold: 'dumbbell',
    props: ['incline'],
    start: { torso: 225, uarm: 45, farm: 165, thigh: 90, shin: 0 },
    end: { torso: 225, uarm: 160, farm: 165, thigh: 90, shin: 0 },
  },
  'overhead-press': {
    hold: 'barbell',
    start: { ...stand, uarm: 20, farm: 170 },
    end: { ...stand, uarm: 175, farm: 180 },
  },
  'seated-press': {
    hold: 'dumbbell',
    props: ['seat'],
    start: { ...sit, uarm: 20, farm: 170 },
    end: { ...sit, uarm: 175, farm: 180 },
  },
  'push-press': {
    hold: 'barbell',
    start: { ...stand, uarm: 20, farm: 170 },
    via: [{ torso: 175, uarm: 20, farm: 170, thigh: 32, shin: 335 }],
    end: { ...stand, uarm: 175, farm: 180 },
  },
  thruster: {
    hold: 'barbell',
    start: { torso: 160, uarm: 77, farm: 227, thigh: 98, shin: 328 },
    end: { ...stand, uarm: 175, farm: 180 },
  },
  'push-up': {
    thumb: 0,
    pin: 'toe',
    trace: 'head',
    start: plankHigh,
    // Solved so the hands and toes stay planted while the elbows bend.
    via: [{ torso: 101.9, uarm: -50.5, farm: 41.25, thigh: 281.9, shin: 281.9, foot: 0 }],
    end: { torso: 94, uarm: -79.75, farm: 53.25, thigh: 274, shin: 274, foot: 0 },
  },
  dip: {
    anchor: 'bar',
    barY: 36,
    pin: 'wrist',
    props: ['dip-bars'],
    trace: 'head',
    start: { torso: 175, uarm: 357, farm: 0, thigh: 10, shin: 315 },
    end: { torso: 162, uarm: 300, farm: 20, thigh: 25, shin: 320 },
  },
  'bench-dip': {
    props: ['hand-bench'],
    trace: 'hip',
    start: { torso: 180, uarm: -33, farm: 10.4, thigh: 88, shin: 0 },
    end: { torso: 180, uarm: -75.6, farm: 25.3, thigh: 117.5, shin: -2.2 },
  },

  // ── Pulling ──────────────────────────────────────────────────────
  row: {
    thumb: 0,
    hold: 'barbell',
    start: { torso: 115, uarm: 0, farm: 0, thigh: 20, shin: 345 },
    end: { torso: 115, uarm: 235, farm: 5, thigh: 20, shin: 345 },
  },
  'upright-row': {
    hold: 'barbell',
    start: stand,
    end: { ...stand, uarm: 100, farm: 275 },
  },
  'pull-up': {
    anchor: 'bar',
    pin: 'wrist',
    props: ['pullup-bar'],
    trace: 'head',
    start: { torso: 180, uarm: 180, farm: 180, thigh: 10, shin: 310 },
    end: { torso: 185, uarm: 312, farm: 180, thigh: 10, shin: 310 },
  },
  'inverted-row': {
    pin: 'ankle',
    props: ['low-bar'],
    trace: 'head',
    start: { torso: 245, head: 245, uarm: 163.1, farm: 163.1, thigh: 65, shin: 65, foot: 160 },
    via: [{ torso: 234.7, head: 234.7, uarm: 221.75, farm: 116, thigh: 54.7, shin: 54.7, foot: 150 }],
    end: { torso: 224.4, head: 224.4, uarm: 270, farm: 123.3, thigh: 44.4, shin: 44.4, foot: 140 },
  },
  'lat-pulldown': {
    hold: 'cable-over',
    props: ['seat'],
    start: { ...sit, torso: 188, uarm: 178, farm: 178 },
    end: { ...sit, torso: 192, uarm: 355, farm: 160 },
  },
  'seated-cable-row': {
    hold: 'cable-mid',
    props: ['seat'],
    start: { torso: 165, uarm: 90, farm: 90, thigh: 82, shin: 75 },
    end: { torso: 185, uarm: 325, farm: 85, thigh: 82, shin: 75 },
  },
  'straight-arm-pulldown': {
    hold: 'cable-high',
    start: { torso: 165, uarm: 140, farm: 140, thigh: 8, shin: 355 },
    end: { torso: 165, uarm: 5, farm: 5, thigh: 8, shin: 355 },
  },
  'face-pull': {
    hold: 'cable-mid',
    start: { ...stand, uarm: 100, farm: 100 },
    end: { ...stand, uarm: 100, farm: 250 },
  },
  'hanging-leg-raise': {
    anchor: 'bar',
    pin: 'wrist',
    props: ['pullup-bar'],
    trace: 'ankle',
    start: { torso: 180, uarm: 180, farm: 180, thigh: 5, shin: 355 },
    end: { torso: 175, uarm: 180, farm: 180, thigh: 95, shin: 95 },
  },

  // ── Arms and shoulders ───────────────────────────────────────────
  curl: {
    hold: 'dumbbell',
    start: stand,
    end: { ...stand, farm: 160 },
  },
  'preacher-curl': {
    hold: 'barbell',
    props: ['preacher'],
    start: { ...sit, torso: 168, uarm: 42, farm: 55 },
    end: { ...sit, torso: 168, uarm: 42, farm: 168 },
  },
  'concentration-curl': {
    hold: 'dumbbell',
    props: ['seat'],
    start: { ...sit, torso: 128, uarm: 2, farm: 0 },
    end: { ...sit, torso: 128, uarm: 2, farm: 150 },
  },
  'triceps-extension': {
    hold: 'dumbbell',
    start: { ...stand, uarm: 180, farm: 330 },
    end: { ...stand, uarm: 180, farm: 180 },
  },
  'skull-crusher': {
    hold: 'barbell',
    props: ['bench'],
    thumb: 0,
    start: { torso: 270, head: 268, uarm: 192, farm: 278, thigh: 90, shin: 0 },
    end: { torso: 270, head: 268, uarm: 175, farm: 180, thigh: 90, shin: 0 },
  },
  kickback: {
    hold: 'dumbbell',
    start: { torso: 105, uarm: 285, farm: 0, thigh: 15, shin: 345 },
    end: { torso: 105, uarm: 285, farm: 285, thigh: 15, shin: 345 },
  },
  'triceps-pushdown': {
    hold: 'cable-high',
    start: { ...stand, torso: 175, uarm: 0, farm: 140 },
    end: { ...stand, torso: 175, uarm: 0, farm: 0 },
  },
  pullover: {
    hold: 'dumbbell',
    props: ['bench'],
    start: { torso: 270, head: 268, uarm: 178, farm: 178, thigh: 90, shin: 0 },
    end: { torso: 270, head: 268, uarm: 268, farm: 275, thigh: 90, shin: 0 },
  },
  raise: {
    hold: 'dumbbell',
    start: stand,
    end: { ...stand, uarm: 90, farm: 90 },
  },
  'arm-circles': {
    trace: 'wrist',
    start: { ...stand, uarm: 20, farm: 20 },
    via: [{ ...stand, uarm: 110, farm: 110 }, { ...stand, uarm: 200, farm: 200 }, { ...stand, uarm: 290, farm: 290 }],
    end: { ...stand, uarm: 380, farm: 380 },
  },

  // ── Core ─────────────────────────────────────────────────────────
  plank: {
    pin: 'toe',
    start: { torso: 99, uarm: 0, farm: 90, thigh: 279, shin: 279, foot: 0 },
    end: { torso: 99, uarm: 0, farm: 90, thigh: 279, shin: 279, foot: 0 },
  },
  'mountain-climber': {
    pin: 'wrist',
    trace: 'knee',
    start: { ...plankHigh, thigh2: 289.8, shin2: 289.8, foot2: 0 },
    via: [{ ...plankHigh, thigh: 330, shin: 250, foot: 320, thigh2: 289.8, shin2: 289.8, foot2: 0 }],
    end: { ...plankHigh, thigh: 420, shin: 265, foot: 300, thigh2: 289.8, shin2: 289.8, foot2: 0 },
  },
  crunch: {
    pin: 'hip',
    trace: 'head',
    start: { ...supine, uarm: 225, farm: 20 },
    end: { ...supine, torso: 240, head: 225, uarm: 200, farm: 0 },
  },
  'sit-up': {
    pin: 'hip',
    trace: 'head',
    start: { ...supine, uarm: 225, farm: 20 },
    end: { ...supine, torso: 195, head: 185, uarm: 160, farm: 330 },
  },
  'reverse-crunch': {
    pin: 'shoulder',
    trace: 'knee',
    start: { torso: 270, head: 266, uarm: 90, farm: 90, thigh: 175, shin: 90 },
    end: { torso: 285, head: 272, uarm: 90, farm: 90, thigh: 225, shin: 130 },
  },
  'lying-leg-raise': {
    pin: 'hip',
    trace: 'ankle',
    start: { ...flat, uarm: 90, farm: 90, thigh: 95, shin: 95 },
    end: { ...flat, uarm: 90, farm: 90, thigh: 178, shin: 178 },
  },
  'flutter-kick': {
    pin: 'hip',
    start: { ...flat, uarm: 90, farm: 90, thigh: 108, shin: 108, thigh2: 128, shin2: 128 },
    end: { ...flat, uarm: 90, farm: 90, thigh: 128, shin: 128, thigh2: 108, shin2: 108 },
  },
  'dead-bug': {
    pin: 'hip',
    trace: 'wrist',
    start: { torso: 270, head: 266, uarm: 180, farm: 180, uarm2: 180, thigh: 180, shin: 90, thigh2: 180, shin2: 90 },
    end: { torso: 270, head: 266, uarm: 268, farm: 268, uarm2: 180, thigh: 180, shin: 90, thigh2: 98, shin2: 98 },
  },
  'ab-rollout': {
    hold: 'wheel',
    pin: 'knee',
    start: { torso: 118, uarm: 22.2, farm: 22.2, thigh: 18, shin: 270, foot: 270 },
    end: { torso: 97, uarm: 81.8, farm: 81.8, thigh: 72, shin: 270, foot: 270 },
  },
  'hanging-knee-raise': {
    anchor: 'bar',
    pin: 'wrist',
    props: ['pullup-bar'],
    trace: 'knee',
    start: { torso: 180, uarm: 180, farm: 180, thigh: 5, shin: 355 },
    end: { torso: 178, uarm: 180, farm: 180, thigh: 110, shin: 5 },
  },
  superman: {
    pin: 'hip',
    trace: 'head',
    start: { torso: 90, head: 90, uarm: 90, farm: 90, thigh: 270, shin: 270, foot: 270 },
    end: { torso: 102, head: 108, uarm: 112, farm: 112, thigh: 258, shin: 255, foot: 255 },
  },

  // ── Glutes and legs ──────────────────────────────────────────────
  'glute-kickback': {
    pin: 'wrist',
    trace: 'ankle',
    start: { torso: 108.4, uarm: 0, farm: 0, thigh: 0, shin: 270, foot: 270, thigh2: 0, shin2: 270, foot2: 270 },
    end: { torso: 108.4, uarm: 0, farm: 0, thigh: -98, shin: 170, foot: 170, thigh2: 0, shin2: 270, foot2: 270 },
  },
  'calf-raise': {
    pin: 'toe',
    trace: 'head',
    start: { ...stand, foot: 90 },
    end: { ...stand, foot: 35 },
  },
  'tuck-jump': {
    trace: 'knee',
    start: { torso: 165, uarm: -20, farm: -20, thigh: 40, shin: 335 },
    end: { torso: 175, uarm: 60, farm: 110, thigh: 110, shin: 10, foot: 30, rise: 14 },
  },
  'farmers-walk': {
    hold: 'dumbbell',
    pin: 'hip',
    trace: 'none',
    start: { ...stand, thigh: 20, shin: 5, foot: 90, thigh2: -15, shin2: -25, foot2: 50 },
    end: { ...stand, thigh: -15, shin: -25, foot: 50, thigh2: 20, shin2: 5, foot2: 90 },
  },

  // ── Stretches ────────────────────────────────────────────────────
  'toe-touch': {
    trace: 'wrist',
    start: { ...stand, uarm: 175, farm: 175 },
    end: { torso: 38, head: 30, uarm: 12, farm: 12, thigh: -14, shin: 8 },
  },
  'seated-hamstring-stretch': {
    pin: 'hip',
    reach: { to: 'toe', bend: -1 },
    start: { ...flat, torso: 180, head: 180, uarm: 90, farm: 90, grip: 0 },
    end: { ...flat, torso: 122, head: 112, uarm: 90, farm: 90 },
  },
  'quad-stretch': {
    reach: { to: 'ankle', bend: 1 },
    start: { ...stand, grip: 0, thigh2: 0, shin2: 0 },
    end: { ...stand, thigh: 12, shin: -160, foot: -100, thigh2: 0, shin2: 0 },
  },
  'knee-to-chest': {
    pin: 'hip',
    reach: { to: 'knee', bend: -1 },
    start: { ...flat, uarm: 90, farm: 90, grip: 0 },
    end: { ...flat, uarm: 150, farm: 150, thigh: 210, shin: 120, foot: 150 },
  },
  'childs-pose': {
    pin: 'knee',
    trace: 'hip',
    start: { torso: 180, uarm: 175, farm: 175, thigh: 0, shin: 270, foot: 270 },
    end: { torso: 84, head: 75, uarm: 92, farm: 90, thigh: 75, shin: 270, foot: 270 },
  },
  'leg-swing': {
    trace: 'ankle',
    start: { ...stand, uarm: 30, farm: 30, thigh: -25, shin: -25, foot: 70, thigh2: 0, shin2: 0 },
    end: { ...stand, uarm: 330, farm: 330, thigh: 80, shin: 80, foot: 130, thigh2: 0, shin2: 0 },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
