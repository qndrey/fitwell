import type { Pose, Template } from './figure';

const stand: Pose = { torso: 180, uarm: 0, farm: 0, thigh: 0, shin: 0 };
const bentKnee = { thigh: 95, shin: 330 };

/** Motions we can draw. Each is a start and an end pose; the app plays the figure between them. */
export const TEMPLATES: Record<string, Template> = {
  'squat-bodyweight': {
    start: { ...stand, uarm: 90, farm: 90 },
    end: { torso: 150, uarm: 90, farm: 90, ...bentKnee },
  },
  'squat-barbell': {
    hold: 'barbell',
    start: { ...stand, uarm: 340, farm: 200 },
    end: { torso: 150, uarm: 340, farm: 200, ...bentKnee },
  },
  'squat-goblet': {
    hold: 'dumbbell',
    start: { ...stand, uarm: 20, farm: 160 },
    end: { torso: 165, uarm: 20, farm: 160, thigh: 95, shin: 335 },
  },
  lunge: {
    start: { ...stand, thigh2: 0, shin2: 0 },
    end: { torso: 180, uarm: 0, farm: 0, thigh: 90, shin: 0, thigh2: 340, shin2: 265 },
  },
  deadlift: {
    thumb: 0,
    hold: 'barbell',
    start: { torso: 140, uarm: 0, farm: 0, thigh: 75, shin: 345 },
    end: stand,
  },
  'romanian-deadlift': {
    hold: 'barbell',
    start: stand,
    end: { torso: 105, uarm: 0, farm: 0, thigh: 12, shin: 355 },
  },
  'kettlebell-swing': {
    hold: 'dumbbell',
    start: { torso: 130, uarm: 20, farm: 10, thigh: 50, shin: 340 },
    end: { ...stand, uarm: 90, farm: 90 },
  },
  'bench-press': {
    thumb: 0,
    hold: 'barbell',
    props: ['bench'],
    start: { torso: 270, uarm: 215, farm: 160, thigh: 90, shin: 0 },
    end: { torso: 270, uarm: 180, farm: 180, thigh: 90, shin: 0 },
  },
  'overhead-press': {
    hold: 'barbell',
    start: { ...stand, uarm: 20, farm: 170 },
    end: { ...stand, uarm: 175, farm: 180 },
  },
  row: {
    thumb: 0,
    hold: 'barbell',
    start: { torso: 115, uarm: 0, farm: 0, thigh: 20, shin: 345 },
    end: { torso: 115, uarm: 235, farm: 5, thigh: 20, shin: 345 },
  },
  'pull-up': {
    anchor: 'bar',
    pin: 'wrist',
    props: ['pullup-bar'],
    start: { torso: 180, uarm: 180, farm: 180, thigh: 10, shin: 310 },
    end: { torso: 185, uarm: 312, farm: 180, thigh: 10, shin: 310 },
  },
  'hanging-leg-raise': {
    anchor: 'bar',
    pin: 'wrist',
    props: ['pullup-bar'],
    start: { torso: 180, uarm: 180, farm: 180, thigh: 5, shin: 345 },
    end: { torso: 180, uarm: 180, farm: 180, thigh: 90, shin: 90 },
  },
  'push-up': {
    thumb: 0,
    pin: 'toe',
    start: { torso: 111, uarm: 0, farm: 0, thigh: 291, shin: 291, foot: 0 },
    end: { torso: 98, uarm: 290, farm: 49, thigh: 278, shin: 278, foot: 0 },
  },
  plank: {
    pin: 'toe',
    start: { torso: 99, uarm: 0, farm: 90, thigh: 279, shin: 279, foot: 0 },
    end: { torso: 99, uarm: 0, farm: 90, thigh: 279, shin: 279, foot: 0 },
  },
  curl: {
    hold: 'dumbbell',
    start: { ...stand },
    end: { ...stand, farm: 160 },
  },
  'triceps-extension': {
    hold: 'dumbbell',
    start: { ...stand, uarm: 180, farm: 330 },
    end: { ...stand, uarm: 180, farm: 180 },
  },
  'triceps-pushdown': {
    hold: 'cable-high',
    start: { ...stand, uarm: 0, farm: 90 },
    end: { ...stand, uarm: 0, farm: 0 },
  },
  raise: {
    hold: 'dumbbell',
    start: { ...stand },
    end: { ...stand, uarm: 90, farm: 90 },
  },
  'calf-raise': {
    start: { ...stand, foot: 90 },
    end: { ...stand, foot: 145 },
  },
  crunch: {
    pin: 'hip',
    start: { torso: 270, uarm: 225, farm: 20, thigh: 130, shin: 47 },
    end: { torso: 240, uarm: 225, farm: 20, thigh: 130, shin: 47 },
  },
  'sit-up': {
    pin: 'hip',
    start: { torso: 270, uarm: 225, farm: 20, thigh: 130, shin: 47 },
    end: { torso: 195, uarm: 225, farm: 20, thigh: 130, shin: 47 },
  },
  'glute-bridge': {
    start: { torso: 270, uarm: 0, farm: 0, thigh: 130, shin: 47 },
    end: { torso: 300, uarm: 0, farm: 0, thigh: 100, shin: 15 },
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
