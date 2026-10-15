// What the exercise guide (the view and the tool) carries. Pure types shared with the views, which can't see server code.
import type { MachineGuide } from './machines';
import type { MotionSpec } from './motion';

export interface ExerciseGuide {
  ref: string;
  name: string;
  category?: string;
  level?: string;
  equipment: string;
  primary: string[];
  secondary: string[];
  /** Step-by-step instructions from the exercise library. */
  instructions: string[];
  /** Setup, cues and mistakes for the machine or cable station, when the exercise uses one. */
  machine: MachineGuide | null;
  /** A 3D animation of the movement, for the exercises that have one. */
  motion: MotionSpec | null;
  /** A video search for the exercise: the demo itself lives elsewhere. */
  demoUrl: string;
}

/** A video search (not a specific video, so nothing can be outdated or taken down). */
export function demoUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise how to`)}`;
}
