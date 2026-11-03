import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BookOpen, Check, LayoutPanelTop, Pencil, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils";
import { BackToTop, SiteHeader, useReveal } from "@/components/landing-extras";
import { ThemeToggle } from "@/components/theme-toggle";
import { CATEGORIES, type Tool, type ToolKind } from "@/lib/tools";

// The screenshots are shared with the home page: <name>-light.png and <name>-dark.png, taken from the real views (apps/mcp/scripts).
const shotFiles = import.meta.glob<string>("../assets/*-{light,dark}.png", { eager: true, import: "default" });
const SIZES: Record<string, [number, number]> = {
  food: [796, 994],
  warmup: [796, 1166],
  swap: [796, 1466],
  "guide-squat": [796, 1000],
  muscles: [796, 1010],
  dashboard: [796, 1216],
  lift: [796, 1836],
  shopping: [796, 1200],
  review: [796, 1216],
  energy: [796, 1216],
  milestone: [796, 842],
  crew: [796, 1570],
  sharecard: [1080, 1350],
};

const TITLE = "Fitwell tools: everything your assistant can do";
const DESC =
  "Every tool your assistant can use in Fitwell: what it is called, what it does, what to say to use it, and how it looks. Food, workouts, progress, meals, streaks, friends and your data.";
const OG_IMAGE = "https://fitwell.fyi/og.png";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fitwell.fyi/tools" },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: "https://fitwell.fyi/tools" }],
  }),
  component: Tools,
});

const KIND: Record<ToolKind, { label: string; icon: typeof Check }> = {
  reads: { label: "Looks only", icon: BookOpen },
  saves: { label: "Saves or changes", icon: Pencil },
  opens: { label: "Opens a page", icon: LayoutPanelTop },
};

function Shot({ name, alt }: { name: string; alt: string }) {
  const light = shotFiles[`../assets/${name}-light.png`];
  const dark = shotFiles[`../assets/${name}-dark.png`];
  const [width, height] = SIZES[name] ?? [796, 1200];
  const card = name === "sharecard";
  return (
    <figure className={cn("w-full overflow-hidden rounded-[1.5rem] border bg-card p-1.5 shadow-phone", card ? "max-w-[300px]" : "max-w-[300px]")}>
      <img src={light} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="shot-light block h-auto w-full rounded-[1.1rem]" />
      <img src={dark} alt="" aria-hidden width={width} height={height} loading="lazy" decoding="async" className="shot-dark block h-auto w-full rounded-[1.1rem]" />
    </figure>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const kind = KIND[tool.kind];
  const Icon = kind.icon;
  return (
    <li className={cn("rounded-2xl border bg-background p-5", tool.shots && "md:col-span-2")}>
      <div className={cn(tool.shots && "grid gap-6 md:grid-cols-[1fr_auto] md:items-start md:gap-8")}>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base font-bold">
            <code className="rounded-md bg-card px-2 py-0.5 font-mono text-sm font-semibold">{tool.name}</code>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              <Icon className="size-3" aria-hidden />
              {kind.label}
            </span>
            {tool.asks && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber bg-amber/10 px-2 py-0.5 text-xs font-semibold">
                <ShieldQuestion className="size-3" aria-hidden />
                Asks first
              </span>
            )}
          </h3>
          <p className="mt-3 leading-relaxed text-muted-foreground">{tool.what}</p>
          <p className="mt-3 text-sm">
            <span className="font-semibold">Try: </span>
            <q className="text-muted-foreground">{tool.ask}</q>
          </p>
        </div>
        {tool.shots && (
          <div className="flex flex-wrap justify-center gap-4 md:justify-end">
            {tool.shots.map((s) => (
              <Shot key={s.name} name={s.name} alt={s.alt} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function Tools() {
  useReveal();
  const total = CATEGORIES.reduce((n, c) => n + c.tools.length, 0);
  return (
    <div id="top" className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <SiteHeader page="/tools">
        <a href="/#join" className="whitespace-nowrap rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Ask for an invite
        </a>
        <ThemeToggle />
      </SiteHeader>

      <main id="main">
        <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 sm:px-8 md:pb-14 md:pt-20">
          <h1 className="max-w-3xl text-4xl sm:text-6xl">Every tool, explained</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Fitwell is a set of {total} things your assistant can do for you. You never type their names: just say what you want, and the assistant picks the right one. This page shows what each one is called, what it does and what to say.
          </p>
          <ul className="mt-6 grid max-w-3xl gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            {(Object.keys(KIND) as ToolKind[]).map((k) => {
              const { label, icon: I } = KIND[k];
              return (
                <li key={k} className="flex items-start gap-2 rounded-xl border bg-card/60 p-3">
                  <I className="mt-0.5 size-4 shrink-0 text-amber" aria-hidden />
                  <span>
                    <strong className="text-foreground">{label}</strong>
                    {k === "reads" ? ": nothing changes." : k === "saves" ? ": something of yours is added or changed." : ": a page shows up in the chat."}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
            <strong className="text-foreground">Asks first</strong> means the assistant checks with you before it changes or removes something. Screenshots show made-up demo data.
          </p>
          <nav aria-label="Categories" className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="inline-block rounded-full border bg-card/60 px-4 py-1.5 text-sm font-semibold hover:bg-card">
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </section>

        <section className="border-t bg-card/40">
          <div data-reveal className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1fr_auto] md:gap-16 md:py-20">
            <div>
              <h2 className="max-w-xl text-3xl sm:text-4xl">See streaks and friends work</h2>
              <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
                Half a minute in the real pages, each opened by one plain request shown above it: a milestone, the share card you can make from it (story size, dark, with a name you chose to add), and the crew feed with a kudos tap.
              </p>
              <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                Recorded with made-up people and numbers; your assistant's wording will differ.{" "}
                <a className="underline underline-offset-4" href="/demo/fitwell-friends.webm">Open the video file</a>.
              </p>
            </div>
            <video
              controls
              playsInline
              preload="none"
              poster="/demo/fitwell-friends-poster.png"
              width={398}
              height={664}
              aria-label="Fitwell streaks and friends: a milestone page, making a share card in story size and dark, and the crew feed with a kudos tap"
              className="mx-auto h-auto w-full max-w-[320px] rounded-2xl border shadow-phone"
            >
              <source src="/demo/fitwell-friends.webm" type="video/webm" />
            </video>
          </div>
        </section>

        {CATEGORIES.map((c, i) => (
          <section key={c.id} id={c.id} className={cn("scroll-mt-8 border-t", i % 2 === 1 && "bg-card/40")}>
            <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 md:py-20">
              <div data-reveal>
                <h2 className="text-3xl sm:text-4xl">{c.title}</h2>
                <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">{c.blurb}</p>
              </div>
              <ul className="mt-8 grid gap-4 md:grid-cols-2">
                {c.tools.map((t) => (
                  <ToolCard key={t.name} tool={t} />
                ))}
              </ul>
            </div>
          </section>
        ))}

        <section className="border-t">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 md:py-20">
            <h2 className="text-3xl sm:text-4xl">Emails, if you want them</h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-muted-foreground">
              Two optional emails, both off until you ask your assistant to turn them on: a Sunday summary of your week, and one nudge after a few quiet days. They arrive in your own evening, say plainly what you did, never what you should have, and every one has an unsubscribe link.
            </p>
            <p className="mt-6">
              <a href="/#join" className="inline-block rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
                Ask for an invite
              </a>
            </p>
          </div>
        </section>
      </main>

      <Footer />
      <BackToTop />
    </div>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-12 text-sm text-muted-foreground sm:px-8">
        <p className="font-semibold text-foreground">Screenshots show made-up demo data.</p>
        <p>
          Food data: Frida 5.5, DTU National Food Institute (CC BY 4.0), and Open Food Facts contributors (ODbL). Exercises: free-exercise-db (public domain). Typeface: Figtree (SIL OFL).
        </p>
        <p>Fitwell is an independent project and is not affiliated with Anthropic.</p>
        <p className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="/" className="underline underline-offset-4 hover:text-foreground">
            Home
          </a>
          <a href="https://mcp.fitwell.fyi/privacy" className="underline underline-offset-4 hover:text-foreground">
            Privacy notice
          </a>
          <a href="mailto:hello@fitwell.fyi" className="underline underline-offset-4 hover:text-foreground">
            hello@fitwell.fyi
          </a>
        </p>
      </div>
    </footer>
  );
}
