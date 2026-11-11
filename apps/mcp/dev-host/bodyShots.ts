// The page of `scripts/body-shots.ts`: the 3D figure alone, with no host and no server, so a script can pose it and take pictures.
import { MOTIONS } from '../src/exercises/motion';
import { createMotionPlayer } from '../ui/shared/motionView';

const player = createMotionPlayer();
if (player) document.body.append(player.element);

Object.assign(globalThis, {
  /** Shows a movement by its library name (null: the figure at ease) with these muscles lit. */
  showExercise(name: string | null, primary: string[] = [], secondary: string[] = []) {
    const spec = name ? MOTIONS[name] : null;
    if (name && !spec) throw new Error(`no movement for ${name}`);
    player?.show(spec ?? null, name ?? 'the figure at ease', { primary, secondary });
  },
  showHeat(colours: Record<string, number>) {
    player?.showHeat(new Map(Object.entries(colours)), 'heat map');
  },
});
