import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Icon } from '../../ui';
import { figureFor } from '../../illustrations/match';
import { figureAt } from '../../illustrations/svg';
import { keyPoses } from '../../illustrations/figure';
import { t } from '../../i18n';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PERIOD_MS = 2600;

/** Small picture for lists: the telling end of the motion over a faint copy of the other end. Exercises without a drawing get a dumbbell in the same box so the text still lines up. */
export function ExerciseThumb({ name, small }: { name: string; small?: boolean }) {
  const fig = useMemo(() => figureFor(name), [name]);
  if (!fig) return <span class={small ? 'fig-blank small' : 'fig-blank'} aria-hidden="true"><Icon name="strength" /></span>;
  return <svg class={small ? 'fig fig-thumb small' : 'fig fig-thumb'} viewBox="0 0 120 80" aria-hidden="true" dangerouslySetInnerHTML={{ __html: figureAt(fig.template, fig.template.thumb ?? 1, { ghost: true }) }} />;
}

/** The movement as a slow loop between start and end, over the dotted path it takes. Pause it, or step by hand when you prefer less motion. */
export function ExerciseFigure({ name }: { name: string }) {
  const fig = useMemo(() => figureFor(name), [name]);
  const reduced = reducedMotion();
  const [playing, setPlaying] = useState(!reduced);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    if (!playing || !fig) return;
    let raf = 0;
    const t0 = performance.now() - pos * (PERIOD_MS / 2);
    const tick = (now: number) => {
      const x = ((now - t0) % PERIOD_MS) / PERIOD_MS;
      setPos(0.5 - 0.5 * Math.cos(2 * Math.PI * x));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fig?.id]);

  if (!fig) return null;
  const still = keyPoses(fig.template).every((p) => JSON.stringify(p) === JSON.stringify(fig.template.start));
  return (
    <figure class="ex-figure">
      <svg class="fig" viewBox="0 0 120 80" role="img" aria-label={`${name}: ${t('exercise.fig.alt')}`} dangerouslySetInnerHTML={{ __html: figureAt(fig.template, pos, { trace: true, ghost: reduced }) }} />
      {!still && (
        <figcaption class="cluster between">
          <span class="t-caption">{pos < 0.5 ? t('exercise.fig.start') : t('exercise.fig.end')}</span>
          {reduced ? (
            <Button size="sm" onClick={() => setPos(pos < 0.5 ? 1 : 0)}>{t('exercise.fig.switch')}</Button>
          ) : (
            <Button size="sm" onClick={() => setPlaying(!playing)}>
              <Icon name={playing ? 'stop' : 'play'} size="sm" />{playing ? t('exercise.fig.pause') : t('exercise.fig.play')}
            </Button>
          )}
        </figcaption>
      )}
    </figure>
  );
}
