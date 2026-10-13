import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraFailure, startCamera, type Camera, type CameraError } from '../../scan/camera';
import { createDetector } from '../../scan/detector';
import { gtinValid, normalizeBarcode } from '@fitwell/core/ean';
import { OffError } from '@fitwell/core/off/client';
import { offLookup } from '../../off';
import { online } from '../../state';
import { Button, Field, Icon, Notice, Sheet, TextInput } from '../../ui';
import { t } from '../../i18n';
import type { FoodItem } from '@fitwell/core/domain/foods';
import { candidateToFood } from './online';

type Phase =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'notFound'; code: string }
  | { kind: 'later'; code: string; reason: string }
  | { kind: 'noCamera'; why: CameraError | 'decoder' };

/**
 * Point the camera at a barcode. Found → the food; unknown → say so; offline or OFF busy → offer to keep the
 * code and look it up later (it joins the pending queue). Typing the number always works as a fallback.
 */
export function ScanSheet({
  onFood,
  onLater,
  onCustom,
  onClose,
}: {
  onFood: (food: FoodItem) => void;
  /** Omit where "look it up later" makes no sense (e.g. choosing a food for an existing entry). */
  onLater?: (barcode: string) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0); // bump to scan again
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');

  async function handleCode(raw: string) {
    const code = normalizeBarcode(raw);
    if (!code) return false;
    setPhase({ kind: 'looking', code });
    if (!online.value) {
      setPhase({ kind: 'later', code, reason: t('scan.offline') });
      return true;
    }
    try {
      const found = await offLookup.search(code, 'interactive');
      if (found[0]) onFood(candidateToFood(found[0]));
      else setPhase({ kind: 'notFound', code });
    } catch (e) {
      const kind = e instanceof OffError ? e.kind : 'server';
      setPhase({ kind: 'later', code, reason: kind === 'offline' ? t('scan.offline') : t('scan.busy') });
    }
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    let camera: Camera | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPhase({ kind: 'starting' });

    (async () => {
      try {
        camera = await startCamera(video.current!);
        const detector = await createDetector().catch(() => null);
        if (cancelled) return;
        if (!detector) throw new CameraFailure('unavailable');
        setPhase({ kind: 'scanning' });
        const tick = async () => {
          if (cancelled) return;
          const v = video.current;
          if (v && v.readyState >= 2) {
            try {
              for (const raw of await detector.detect(v)) {
                if (gtinValid(raw) && (await handleCode(raw))) {
                  camera?.stop(); // done: release the camera immediately
                  return;
                }
              }
            } catch {
              /* a bad frame is not an error: try the next one */
            }
          }
          timer = setTimeout(() => void tick(), 150);
        };
        void tick();
      } catch (e) {
        camera?.stop();
        if (!cancelled) setPhase({ kind: 'noCamera', why: e instanceof CameraFailure ? e.kind : 'decoder' });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      camera?.stop();
    };
  }, [attempt]);

  const showVideo = phase.kind === 'starting' || phase.kind === 'scanning';
  const noCameraText = phase.kind === 'noCamera' ? (phase.why === 'denied' ? t('scan.denied') : phase.why === 'insecure' ? t('scan.insecure') : t('scan.unavailable')) : '';

  return (
    <Sheet title={t('scan.title')} onClose={onClose}>
      <div class="stack gap-4">
        <div class="scan-frame" hidden={!showVideo}>
          <video ref={video} class="scan-video" aria-label={t('scan.preview')} />
          <div class="scan-guide" aria-hidden="true" />
        </div>
        {phase.kind === 'starting' && <p class="muted" role="status">{t('scan.starting')}</p>}
        {phase.kind === 'scanning' && <p class="muted" role="status">{t('scan.hint')}</p>}
        {phase.kind === 'looking' && <p class="muted" role="status">{t('scan.looking')} {phase.code}…</p>}
        {phase.kind === 'noCamera' && <Notice quiet role="status">{noCameraText}</Notice>}

        {phase.kind === 'notFound' && (
          <div class="stack gap-3">
            <Notice quiet role="status">{t('scan.notFound').replace('{code}', phase.code)}</Notice>
            <Button variant="primary" block onClick={onCustom}>{t('custom.create')}</Button>
            <Button block onClick={() => setAttempt((n) => n + 1)}><Icon name="scan" size="sm" />{t('scan.again')}</Button>
          </div>
        )}
        {phase.kind === 'later' && (
          <div class="stack gap-3">
            <Notice quiet role="status">{phase.reason}</Notice>
            {onLater && <Button variant="primary" block onClick={() => onLater(phase.code)}>{t('scan.keep')}</Button>}
            <Button block onClick={() => setAttempt((n) => n + 1)}><Icon name="scan" size="sm" />{t('scan.again')}</Button>
          </div>
        )}

        {(showVideo || phase.kind === 'noCamera') && (
          <form
            class="stack gap-2"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!(await handleCode(typed))) setTypedError(t('scan.invalid'));
            }}
          >
            <Field label={t('scan.type')} error={typedError} hint={typedError ? undefined : t('scan.typeHint')}>
              {(c) => (
                <TextInput
                  {...c}
                  inputMode="numeric"
                  autocomplete="off"
                  value={typed}
                  onInput={(e) => (setTyped((e.target as HTMLInputElement).value), setTypedError(''))}
                />
              )}
            </Field>
            <Button type="submit" block>{t('scan.lookUp')}</Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
