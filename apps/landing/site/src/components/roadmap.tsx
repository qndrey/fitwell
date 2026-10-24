import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Compass, Hammer, Lightbulb, Mail, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { ITEMS, STAGES, STATUS_LABEL, THEMES, type RoadmapItem, type StageId, type Status, type ThemeId } from "@/lib/roadmap";

const STATUS_ICON: Record<Status, typeof Check> = { shipped: Check, next: Hammer, planned: Compass, exploring: Lightbulb };
const STATUS_STYLE: Record<Status, string> = {
  shipped: "border-primary/40 text-foreground",
  next: "border-amber bg-amber/10 text-foreground",
  planned: "text-muted-foreground",
  exploring: "border-dashed text-muted-foreground",
};

const NOW: StageId = "next";
const nowIndex = STAGES.findIndex((s) => s.id === NOW);

function Badge({ status }: { status: Status }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      <Icon className="size-3" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Card({ item, open, onToggle }: { item: RoadmapItem; open: boolean; onToggle: () => void }) {
  const themeLabel = THEMES.find((t) => t.id === item.theme)?.label ?? "";
  const panelId = `rm-${item.id}`;
  return (
    <li className={cn("flex flex-col rounded-xl border bg-background transition-shadow", open && "shadow-phone")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full flex-1 items-start gap-3 rounded-xl p-4 text-left sm:p-5"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge status={item.status} />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{themeLabel}</span>
          </span>
          <span className="mt-2 block font-bold">{item.title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.summary}</span>
        </span>
        <ChevronDown className={cn("mt-1 size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={panelId} hidden={!open} className="px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="border-t pt-3 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
        {item.status !== "shipped" && (
          <a
            href={`mailto:hello@fitwell.fyi?subject=${encodeURIComponent(`Roadmap: ${item.title}`)}&body=${encodeURIComponent("I would use this because:\n")}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            <Mail className="size-4" aria-hidden /> I would use this
          </a>
        )}
      </div>
    </li>
  );
}

export function Roadmap() {
  const [stage, setStage] = useState<StageId>(NOW);
  const [theme, setTheme] = useState<ThemeId | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const shippedCount = ITEMS.filter((i) => i.status === "shipped").length;
  const inStage = (s: StageId) => ITEMS.filter((i) => i.stage === s && (theme === "all" || i.theme === theme));
  const visible = useMemo(() => inStage(stage), [stage, theme]);
  const stageInfo = STAGES.find((s) => s.id === stage) ?? STAGES[0]!;
  const stageIndex = STAGES.findIndex((s) => s.id === stage);

  // When a theme has nothing in the chosen stage, point to the nearest stage that has it.
  const elsewhere =
    visible.length === 0
      ? [...STAGES.slice(stageIndex + 1), ...STAGES.slice(0, stageIndex)].find((s) => inStage(s.id).length > 0)
      : undefined;

  const select = (s: StageId) => {
    setStage(s);
    setOpenId(null);
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + STAGES.length) % STAGES.length;
    const target = STAGES[next];
    if (target) {
      select(target.id);
      tabs.current[next]?.focus();
    }
  };

  const themeCount = (t: ThemeId | "all") => ITEMS.filter((i) => i.stage === stage && (t === "all" || i.theme === t)).length;

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <p className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber" aria-hidden />
          <span>
            <strong className="text-foreground">{shippedCount}</strong> things shipped, {ITEMS.length - shippedCount} planned or being explored
          </span>
        </p>
        <p>Plans, not promises: the order can change and there are no dates.</p>
      </div>

      {/* The path: one stop per stage. */}
      <div role="tablist" aria-label="Roadmap stages" className="mt-10 grid grid-cols-5">
        {STAGES.map((s, i) => {
          const selected = s.id === stage;
          const done = i < nowIndex;
          const current = i === nowIndex;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`rm-tab-${s.id}`}
              aria-selected={selected}
              aria-controls="rm-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => select(s.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className="group relative flex flex-col items-center px-1 pb-2 text-center"
            >
              {/* Connector to the next stop; filled up to where the work is now. */}
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-[15px] h-0.5 w-full",
                    i < nowIndex ? "bg-primary" : i === nowIndex ? "bg-gradient-to-r from-primary to-border" : "bg-border [background-image:repeating-linear-gradient(90deg,var(--border)_0_6px,transparent_6px_12px)]",
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-8 items-center justify-center rounded-full border-2 bg-background text-sm font-bold transition-all",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-amber text-amber",
                  !done && !current && "border-border text-muted-foreground",
                  selected && "scale-110 ring-4 ring-ring/20",
                )}
              >
                {done ? <Check className="size-4" /> : current ? <Hammer className="size-4" /> : i + 1}
              </span>
              <span className={cn("mt-2 text-sm font-bold", selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{s.label}</span>
              <span className="mt-0.5 hidden text-xs leading-snug text-muted-foreground sm:block">{s.sub}</span>
            </button>
          );
        })}
      </div>

      <div id="rm-panel" role="tabpanel" aria-labelledby={`rm-tab-${stage}`} className="mt-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-2xl sm:text-3xl">{stageInfo.sub}</h3>
            <p className="mt-2 max-w-xl text-muted-foreground">{stageInfo.blurb}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by theme">
            {([{ id: "all", label: "All" }, ...THEMES] as { id: ThemeId | "all"; label: string }[]).map((t) => {
              const count = themeCount(t.id);
              const active = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTheme(t.id);
                    setOpenId(null);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-semibold transition-colors",
                    active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-card",
                    !active && count === 0 && "opacity-50",
                  )}
                >
                  {t.label} <span className="font-normal opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {visible.length > 0 ? (
          <ul className="mt-6 grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <Card key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} />
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed p-6 text-muted-foreground">
            <p>Nothing about {THEMES.find((t) => t.id === theme)?.label.toLowerCase()} in this stage.</p>
            {elsewhere ? (
              <button type="button" onClick={() => select(elsewhere.id)} className="mt-2 font-semibold text-primary underline underline-offset-4">
                See it in "{elsewhere.label}"
              </button>
            ) : null}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <button
            type="button"
            disabled={stageIndex === 0}
            onClick={() => select(STAGES[stageIndex - 1]!.id)}
            className="font-semibold text-primary underline-offset-4 hover:underline disabled:invisible"
          >
            <span aria-hidden>← </span>Earlier
          </button>
          <button
            type="button"
            disabled={stageIndex === STAGES.length - 1}
            onClick={() => select(STAGES[stageIndex + 1]!.id)}
            className="font-semibold text-primary underline-offset-4 hover:underline disabled:invisible"
          >
            Later<span aria-hidden> →</span>
          </button>
        </div>
      </div>
    </div>
  );
}
