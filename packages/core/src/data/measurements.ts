/**
 * Preset body measurements. Ids are stable ("mt:<key>"): releases may add presets, never change what a key means.
 * `hint` explains where and how to measure so numbers stay comparable over time.
 */
export interface Preset {
  key: string;
  label: string;
  kind: 'length' | 'percent';
  /** On for new users. Everything can be switched in Settings. */
  defaultOn: boolean;
  hint: string;
}

export const PRESETS: Preset[] = [
  { key: 'waist', label: 'Waist', kind: 'length', defaultOn: true, hint: 'Around the narrowest part of your torso, usually just above the belly button. Stand relaxed, breathe out normally, tape snug but not tight. Same time of day each time, ideally in the morning.' },
  { key: 'hips', label: 'Hips', kind: 'length', defaultOn: true, hint: 'Around the widest part of your hips and buttocks, feet together, tape level all the way round.' },
  { key: 'chest', label: 'Chest', kind: 'length', defaultOn: true, hint: 'Around the fullest part of your chest, under the armpits, arms relaxed at your sides. Breathe normally.' },
  { key: 'neck', label: 'Neck', kind: 'length', defaultOn: false, hint: 'Just below the Adam’s apple, looking straight ahead with shoulders relaxed.' },
  { key: 'arm-left', label: 'Left upper arm', kind: 'length', defaultOn: false, hint: 'Halfway between shoulder and elbow, arm hanging relaxed. Measure the same way every time (relaxed or flexed).' },
  { key: 'arm-right', label: 'Right upper arm', kind: 'length', defaultOn: false, hint: 'Halfway between shoulder and elbow, arm hanging relaxed. Measure the same way every time (relaxed or flexed).' },
  { key: 'thigh-left', label: 'Left thigh', kind: 'length', defaultOn: false, hint: 'Around the fullest part of the upper leg, standing with your weight evenly on both feet.' },
  { key: 'thigh-right', label: 'Right thigh', kind: 'length', defaultOn: false, hint: 'Around the fullest part of the upper leg, standing with your weight evenly on both feet.' },
  { key: 'calf-left', label: 'Left calf', kind: 'length', defaultOn: false, hint: 'Around the widest part of the lower leg, standing with your weight evenly on both feet.' },
  { key: 'calf-right', label: 'Right calf', kind: 'length', defaultOn: false, hint: 'Around the widest part of the lower leg, standing with your weight evenly on both feet.' },
  { key: 'body-fat', label: 'Body fat', kind: 'percent', defaultOn: false, hint: 'Type the percentage from your scale, calipers or scan. Different devices give different numbers, so use the same one each time. Fitwell does not estimate it for you.' },
];

export const presetId = (key: string): string => `mt:${key}`;
