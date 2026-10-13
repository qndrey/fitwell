import { useEffect, useState } from 'preact/hooks';
import '../../styles/design.css';
import { contrastRatio, rgbToHex } from '../../domain/contrast';
import type { ThemePreference } from '../../db/schema';
import { settings, updateSettings } from '../../state';
import { Badge, BigNumber, Button, Card, Choice, EmptyState, Field, Icon, ICON_NAMES, LinkButton, List, ListRow, Notice, Screen, SectionTitle, Segmented, Select, Sheet, StatGrid, TextInput } from '../../ui';

/** Re-reads computed tokens whenever the theme changes (setting or device). */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  const theme = settings.value.theme;
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setTick((n) => n + 1);
    mq.addEventListener('change', bump);
    const id = requestAnimationFrame(bump); // after data-theme has been applied
    return () => (mq.removeEventListener('change', bump), cancelAnimationFrame(id));
  }, [theme]);
  return tick;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

/** Resolved colour of a token as #rrggbb (or the raw value if it has transparency). */
function colourOf(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgbToHex(rgb) ?? rgb;
}

const GROUPS: { title: string; note: string; tokens: string[] }[] = [
  { title: 'Surfaces', note: 'Layers from page to card to raised.', tokens: ['bg', 'surface', 'surface-2'] },
  { title: 'Text', note: 'Body and secondary text.', tokens: ['text', 'text-muted'] },
  { title: 'Lines', note: '--border is for controls (3:1). --divider is decorative only.', tokens: ['border', 'divider'] },
  { title: 'Accent', note: 'Calm sage. One primary action per screen.', tokens: ['accent', 'accent-strong', 'on-accent', 'accent-soft', 'on-accent-soft'] },
  { title: 'Feedback', note: 'Focus ring on every interactive element. Danger only for destructive confirmations.', tokens: ['focus', 'danger'] },
  { title: 'Charts', note: 'Six categorical series, checked for colour-vision deficiency. Always add markers or labels.', tokens: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-grid', 'chart-axis'] },
];

const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text-muted', 'surface', 4.5], ['accent', 'bg', 4.5],
  ['on-accent', 'accent', 4.5], ['on-accent-soft', 'accent-soft', 4.5], ['border', 'surface', 3], ['danger', 'surface', 4.5],
];

const TYPE_ROLES: { cls: string; label: string; token: string; sample: string }[] = [
  { cls: 't-display', label: 'Display', token: '--text-3xl · 700', sample: '2,140' },
  { cls: 't-stat', label: 'Stat', token: '--text-2xl · 700', sample: '1,860 kcal' },
  { cls: 't-title', label: 'Title (h1)', token: '--text-xl · 700', sample: 'Today' },
  { cls: 't-heading', label: 'Heading (h2)', token: '--text-lg · 600', sample: 'Breakfast' },
  { cls: 't-subheading', label: 'Subheading (h3)', token: '--text-md · 600', sample: 'Confirm your changes' },
  { cls: 't-body', label: 'Body', token: '--text-md · 400', sample: 'Logging a whole day should take under thirty seconds.' },
  { cls: 't-label', label: 'Label', token: '--text-md · 600', sample: 'Amount' },
  { cls: 't-caption', label: 'Caption', token: '--text-sm · 400 muted', sample: '88 kcal per 100 g' },
  { cls: 't-overline', label: 'Overline', token: '--text-xs · 600 caps', sample: 'Favorites' },
];

const SPACES = [1, 2, 3, 4, 5, 6, 7, 8];
const px = (token: string) => `${Math.round(parseFloat(cssVar(token)) * 16)} px`;

function Swatch({ token }: { token: string }) {
  return (
    <div class="swatch">
      <div class="swatch-chip" style={{ background: `var(--${token})` }} />
      <div class="swatch-meta">
        <strong>{token}</strong>
        <code>{colourOf(token)}</code>
      </div>
    </div>
  );
}

function ChartDemo() {
  const series = [1, 2, 3, 4, 5, 6];
  const names = ['Protein', 'Carbs', 'Fat', 'Fibre', 'Water', 'Steps'];
  const marker = (i: number, x: number, y: number) => {
    const c = `var(--chart-${i + 1})`;
    switch (i % 6) {
      case 0: return <circle cx={x} cy={y} r="4" fill={c} />;
      case 1: return <rect x={x - 4} y={y - 4} width="8" height="8" fill={c} />;
      case 2: return <path d={`M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4} Z`} fill={c} />;
      case 3: return <path d={`M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z`} fill={c} />;
      case 4: return <path d={`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`} stroke={c} stroke-width="2.5" />;
      default: return <path d={`M${x - 5} ${y} L${x + 5} ${y} M${x} ${y - 5} L${x} ${y + 5}`} stroke={c} stroke-width="2.5" />;
    }
  };
  return (
    <figure>
      <svg class="chart-svg" viewBox="0 0 320 140" role="img" aria-label="Example line chart with six series, each with its own marker shape. Values rise gently from left to right.">
        {[30, 70, 110].map((y) => <line key={y} x1="10" x2="310" y1={y} y2={y} stroke="var(--chart-grid)" />)}
        {series.map((n, i) => {
          const pts = [0, 1, 2, 3, 4].map((k) => [30 + k * 65, 118 - (i * 9 + k * 8 + ((i * 7 + k * 5) % 11))]);
          return (
            <g key={n}>
              <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={`var(--chart-${n})`} stroke-width="2" />
              {pts.map(([x, y], k) => <g key={k}>{marker(i, x!, y!)}</g>)}
            </g>
          );
        })}
      </svg>
      <figcaption class="legend">
        {series.map((n, i) => (
          <span key={n}>
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">{marker(i, 0, 0)}</svg>
            {names[i]}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function Design() {
  useThemeTick();
  const [sheet, setSheet] = useState(false);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [check, setCheck] = useState(true);
  const theme = settings.value.theme;

  return (
    <Screen title="Design system" subtitle="Tokens and components, live in the current theme.">
      <div class="page ds">
        <Segmented<ThemePreference>
          legend="Preview theme"
          name="ds-theme"
          value={theme}
          onChange={(v) => void updateSettings({ theme: v })}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />

        <section class="ds-section" aria-labelledby="ds-principles">
          <h2 id="ds-principles">Principles</h2>
          <List>
            <ListRow main="Calm, never guilt-inducing" sub="No red/green judgement on weight, measurements or calories. Danger colour only for destructive confirmations." />
            <ListRow main="Phone first" sub="One column, 44 px targets, primary action in the thumb zone. Wider screens only add." />
            <ListRow main="Fast to log" sub="Common values are one tap (chips, recents). Does it make logging faster or the day clearer?" />
            <ListRow main="Never colour alone" sub="Pair colour with text, shape or position. Errors carry an ⓘ and say what to do." />
          </List>
        </section>

        <section class="ds-section" aria-labelledby="ds-color">
          <h2 id="ds-color">Colour</h2>
          <p class="muted">Themed tokens (light, dark, or follow the device). Use tokens, never hex values.</p>
          <div class="stack gap-5">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <SectionTitle>{g.title}</SectionTitle>
                <p class="t-caption mb-3">{g.note}</p>
                <div class="swatches">{g.tokens.map((tk) => <Swatch key={tk} token={tk} />)}</div>
              </div>
            ))}
            <div>
              <SectionTitle>Chart series in use</SectionTitle>
              <ChartDemo />
            </div>
            <div>
              <SectionTitle>Contrast pairs (WCAG AA)</SectionTitle>
              <div class="pairs" role="list">
                {PAIRS.map(([fg, bg, min]) => {
                  const f = colourOf(fg), b = colourOf(bg);
                  const r = f.startsWith('#') && b.startsWith('#') ? contrastRatio(f, b) : 0;
                  return (
                    <div class="pair" role="listitem" key={fg + bg}>
                      <strong>{fg} on {bg}</strong>
                      {min === 3 ? (
                        <span class="pair-box" aria-hidden="true" style={{ background: `var(--${bg})`, borderColor: `var(--${fg})` }} />
                      ) : (
                        <span class="pair-sample" aria-hidden="true" style={{ background: `var(--${bg})`, color: `var(--${fg})` }}>Aa</span>
                      )}
                      <span>{r.toFixed(1)}:1 {r >= min ? '✓' : '✗'} (min {min})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-type">
          <h2 id="ds-type">Typography</h2>
          <p class="muted">Figtree variable, self-hosted (OFL). Tabular figures everywhere so numbers line up. Body and inputs are never below 16 px.</p>
          <div>
            {TYPE_ROLES.map((r) => (
              <div class="spec" key={r.label}>
                <span class={r.cls}>{r.sample}</span>
                <code>{r.label}<br />{r.token}</code>
              </div>
            ))}
          </div>
          <SectionTitle>Tabular numerals</SectionTitle>
          <div class="numerals t-label">
            <div><span>Banana</span><span>88 kcal</span></div>
            <div><span>Oats</span><span>373 kcal</span></div>
            <div><span>Olive oil</span><span>900 kcal</span></div>
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-space">
          <h2 id="ds-space">Spacing, shape and size</h2>
          <p class="muted">4 px base. Gaps between things come from the scale: <code>gap</code> on stacks, not margins on children.</p>
          <div>
            {SPACES.map((n) => (
              <div class="bar-row" key={n}>
                <code>--space-{n} · {px(`space-${n}`)}</code>
                <div class="bar" style={{ width: `var(--space-${n})` }} />
              </div>
            ))}
          </div>
          <SectionTitle>Radius</SectionTitle>
          <div class="demo-row">
            {['s', 'm', 'l'].map((r) => (
              <div key={r} class="shape" style={{ borderRadius: `var(--radius-${r})` }} aria-label={`radius ${r}`} role="img" />
            ))}
          </div>
          <p class="t-caption mt-2">--radius-s controls · --radius-m cards and lists · --radius-l sheets · --radius-pill segments and the primary action</p>
          <SectionTitle>Touch target</SectionTitle>
          <div class="demo-row"><div class="tap-box" role="img" aria-label="44 pixel square">44</div><p class="t-caption">Every tappable thing is at least 44 × 44 px.</p></div>
        </section>

        <section class="ds-section" aria-labelledby="ds-icons">
          <h2 id="ds-icons">Icons</h2>
          <p class="muted">Lucide (ISC), 2 px stroke, three sizes (--icon-sm/md/lg). Decorative: the meaning always comes from a text label or an aria-label.</p>
          <div class="icon-grid">
            {ICON_NAMES.map((n) => (
              <div class="icon-cell" key={n}>
                <Icon name={n} size="lg" />
                <span class="t-caption">{n}</span>
              </div>
            ))}
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-buttons">
          <h2 id="ds-buttons">Buttons</h2>
          <div class="demo">
            <div class="demo-row">
              <Button variant="primary">Primary</Button>
              <Button>Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
            <div class="demo-row">
              <Button size="sm">Small</Button>
              <Button aria-pressed>Selected</Button>
              <Button disabled>Disabled</Button>
              <Button icon aria-label="Next"><Icon name="next" size="lg" /></Button>
              <LinkButton>Link action</LinkButton>
            </div>
            <Button variant="primary" size="lg" block>Large, full width (the one primary action)</Button>
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-forms">
          <h2 id="ds-forms">Form controls</h2>
          <div class="demo">
            <Field label="Name" hint="Shown in your list.">{(c) => <TextInput {...c} value="Granola bar" />}</Field>
            <Field label="Amount" error="Enter an amount greater than zero.">{(c) => <TextInput {...c} inputMode="decimal" value="0" />}</Field>
            <Field label="Unit">{(c) => <Select {...c}><option>g</option><option>serving (50 g)</option></Select>}</Field>
            <Field label="Read-only">{(c) => <TextInput {...c} value="g" readOnly />}</Field>
            <Choice type="checkbox" checked={check} onChange={setCheck} label="Habit-only mode" help="Hide all calorie and macro numbers." />
            <Segmented
              legend="Example segmented control"
              name="ds-seg"
              value={seg}
              onChange={setSeg}
              options={[{ value: 'a', label: 'Breakfast' }, { value: 'b', label: 'Lunch' }, { value: 'c', label: 'Dinner' }]}
            />
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-surfaces">
          <h2 id="ds-surfaces">Cards, lists and numbers</h2>
          <div class="demo">
            <Card compact label="Example totals">
              <div class="stack gap-2">
                <BigNumber value="1,860" unit="kcal" />
                <StatGrid items={[{ label: 'Protein', value: '92 g' }, { label: 'Carbs', value: '210 g' }, { label: 'Fat', value: '64 g' }]} />
              </div>
            </Card>
            <List>
              <ListRow main="Banana, raw" sub="120 g · 106 kcal" onClick={() => undefined} />
              <ListRow main="Oats, rolled" sub="60 g · 224 kcal" onClick={() => undefined} />
              <ListRow main="Static row" sub="Not tappable" />
            </List>
            <EmptyState>Nothing logged yet. Whatever you add today will show up here.</EmptyState>
          </div>
        </section>

        <section class="ds-section" aria-labelledby="ds-feedback">
          <h2 id="ds-feedback">Feedback</h2>
          <div class="demo">
            <Notice>Info: a calm message in the accent tint.</Notice>
            <Notice quiet>Quiet: neutral, for supporting detail.</Notice>
            <div class="demo-row"><Badge>pending</Badge><Badge>3 to confirm</Badge></div>
            <div class="toast"><span>Removed.</span><Button size="sm">Undo</Button></div>
            <Button onClick={() => setSheet(true)}>Open a sheet</Button>
          </div>
        </section>

        {sheet && (
          <Sheet title="Example sheet" onClose={() => setSheet(false)}>
            <div class="stack gap-3">
              <p>Sheets slide up on phones and centre on larger screens. The header stays, the body scrolls, the main action sits at the bottom.</p>
              <div class="sticky-action"><Button variant="primary" block onClick={() => setSheet(false)}>Done</Button></div>
            </div>
          </Sheet>
        )}
      </div>
    </Screen>
  );
}
