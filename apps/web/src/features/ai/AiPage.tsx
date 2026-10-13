import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button, Card, Field, Icon, LinkButton, Notice, Screen, Segmented, TextInput } from '../../ui';
import { copyText } from '../../ai/clipboard';
import { parseAiReply, type AiWorkout, type ParseResult } from '../../ai/importWorkout';
import { analysisPrompt, workoutRequestPrompt, type AnalysisKind, type LoggedData } from '../../ai/prompts';
import { addDays, today } from '../../domain/dates';
import { goals, settings } from '../../state';
import { t } from '../../i18n';
import { loadRange } from '../stats/data';
import { showToast } from '../food/toast';
import { ImportPreview } from './ImportPreview';

const RANGES = [7, 30, 90] as const;
const EMPTY: LoggedData = { entries: [], workouts: [], weights: [] };

/** A read-only preview of exactly what will be copied, and the button that copies it. */
function PromptBox({ id, text, label }: { id: string; text: string; label: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    if (await copyText(text)) showToast(t('ai.copied'));
    else {
      area.current?.focus();
      area.current?.select();
      showToast(t('ai.copyFailed'));
    }
  }
  return (
    <div class="stack gap-2">
      <Field label={label} hint={`${text.length.toLocaleString()} ${t('ai.chars')}`}>
        {(c) => <textarea {...c} ref={area} class="input prompt-box" readOnly rows={8} value={text} data-id={id} />}
      </Field>
      <Button block variant="primary" onClick={() => void copy()}>
        <Icon name="check" size="sm" />{t('ai.copy')}
      </Button>
    </div>
  );
}

/** Take your data to an AI chat of your choice, and bring a workout back. Nothing is sent by the app: copy, paste, check. */
export function AiPage() {
  const units = settings.value.units;
  const [kind, setKind] = useState<AnalysisKind>('both');
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<LoggedData>(EMPTY);
  const [goal, setGoal] = useState('');
  const [day, setDay] = useState(today());
  const [recent, setRecent] = useState<LoggedData>(EMPTY);
  const [paste, setPaste] = useState('');
  const [problem, setProblem] = useState('');
  const [parsed, setParsed] = useState<AiWorkout | null>(null);

  const to = today();
  const from = addDays(to, -(days - 1));
  useEffect(() => {
    let live = true;
    void loadRange(from, to).then((r) => live && setData({ entries: r.entries, workouts: r.workouts, weights: r.weights }));
    return () => {
      live = false;
    };
  }, [days]);
  useEffect(() => {
    let live = true;
    void loadRange(addDays(to, -14), to).then((r) => live && setRecent({ entries: [], workouts: r.workouts, weights: [] }));
    return () => {
      live = false;
    };
  }, []);

  const habitOnly = settings.value.habitOnly;
  const analysis = useMemo(() => analysisPrompt({ kind, from, to, units, data, goals: goals.value, habitOnly }), [kind, days, units, data, goals.value, habitOnly]);
  const request = useMemo(() => workoutRequestPrompt({ goal, day, units, data: recent, recentDays: 14 }), [goal, day, units, recent]);

  function preview() {
    const r: ParseResult = parseAiReply(paste);
    if (r.ok) {
      setProblem('');
      setParsed(r.workout);
      return;
    }
    setProblem(t(`ai.err.${r.reason}` as 'ai.err.no-json') + (r.where ? ` ${t('ai.err.where')} ${r.where}` : ''));
  }

  return (
    <Screen title={t('ai.title')}>
      <LinkButton onClick={() => (location.hash = '#/settings')}>
        <Icon name="prev" size="sm" />{t('ai.back')}
      </LinkButton>
      <Notice>{t('ai.privacy')}</Notice>

      <Card labelledBy="ai-analyse">
        <div class="stack gap-3">
          <h2 id="ai-analyse">{t('ai.analyse.title')}</h2>
          <p class="t-caption">{t('ai.analyse.help')}</p>
          <Segmented
            legend={t('ai.kind')}
            name="ai-kind"
            options={[{ value: 'food', label: t('ai.kind.food') }, { value: 'workouts', label: t('ai.kind.workouts') }, { value: 'both', label: t('ai.kind.both') }]}
            value={kind}
            onChange={setKind}
          />
          <Segmented
            legend={t('ai.range')}
            name="ai-range"
            options={RANGES.map((n) => ({ value: String(n) as '7', label: `${n} ${t('ai.days')}` }))}
            value={String(days) as '7'}
            onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}
          />
          <PromptBox id="analysis" text={analysis} label={t('ai.preview.label')} />
        </div>
      </Card>

      <Card labelledBy="ai-request">
        <div class="stack gap-3">
          <h2 id="ai-request">{t('ai.request.title')}</h2>
          <p class="t-caption">{t('ai.request.help')}</p>
          <Field label={t('ai.goal')}>
            {(c) => <TextInput {...c} autocomplete="off" maxLength={200} placeholder={t('ai.goal.placeholder')} value={goal} onInput={(e) => setGoal((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field label={t('ai.day')}>
            {(c) => <TextInput {...c} type="date" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />}
          </Field>
          <PromptBox id="request" text={request} label={t('ai.preview.label')} />
        </div>
      </Card>

      <Card labelledBy="ai-import">
        <div class="stack gap-3">
          <h2 id="ai-import">{t('ai.import.title')}</h2>
          <p class="t-caption">{t('ai.import.help')}</p>
          <Field label={t('ai.import.paste')} error={problem}>
            {(c) => <textarea {...c} class="input prompt-box" rows={6} autocomplete="off" spellcheck={false} value={paste} onInput={(e) => (setPaste((e.target as HTMLTextAreaElement).value), setProblem(''))} />}
          </Field>
          <Button block disabled={!paste.trim()} onClick={preview}>{t('ai.import.button')}</Button>
        </div>
      </Card>

      {parsed && <ImportPreview workout={parsed} defaultDay={today()} onClose={() => setParsed(null)} />}
    </Screen>
  );
}
