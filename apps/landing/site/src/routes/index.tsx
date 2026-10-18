import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link2,
  Refrigerator,
  TriangleAlert,
  Sunrise,
  Download,
  Copy,
  Check,
  Mail,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Roadmap } from "@/components/roadmap";

// Every screenshot exists in a light and a dark version (<name>-light.png, <name>-dark.png), taken from the
// real views by apps/mcp/scripts/screenshots.ts. The page theme picks one.
const shotFiles = import.meta.glob<string>("../assets/*-{light,dark}.png", { eager: true, import: "default" });
const SIZES: Record<string, [number, number]> = {
  "hero-squat": [796, 1320],
  food: [796, 1212],
  energy: [732, 530],
  warmup: [796, 1146],
  swap: [796, 1984],
  "guide-squat": [796, 1000],
  muscles: [796, 1070],
  shopping: [796, 1472],
  review: [796, 1426],
};

const TITLE = "Fitwell for Claude";
const DESC =
  "A fitness and nutrition coach inside Claude. Log food, plan meals, run workouts and see your progress by talking to Claude. Invite-only, data stored in the EU.";
const OG_IMAGE = "https://fitwell.fyi/og.png";
const OG_ALT = "Fitwell for Claude: track food, training and weight by talking to Claude";
const PRIVACY_URL = "https://mcp.fitwell.fyi/privacy";

/**
 * Where people can chip in towards the running costs. Add each account's link as its `url`: a provider with no URL is not shown,
 * and with none set the whole "Support Fitwell" section stays hidden, so there is never a dead link on the page.
 */
const SUPPORT: { name: string; kind: string; url: string }[] = [
  { name: "Liberapay", kind: "Monthly", url: "https://liberapay.com/fitwell.fyi" },
  { name: "Ko-fi", kind: "One-off", url: "https://ko-fi.com/fitwellfyi" },
  { name: "GitHub Sponsors", kind: "Monthly or one-off", url: "" },
];
const supportLinks = SUPPORT.filter((s) => s.url !== "");
const EMAIL = "fitwell.fyi@pm.me";
const MCP_URL = "https://mcp.fitwell.fyi/mcp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://fitwell.fyi/" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: OG_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "twitter:image:alt", content: OG_ALT },
    ],
    links: [{ rel: "canonical", href: "https://fitwell.fyi/" }],
  }),
  component: Index,
});

function Phone({ name, alt, priority = false, maxH }: { name: string; alt: string; priority?: boolean; maxH?: string | undefined }) {
  const light = shotFiles[`../assets/${name}-light.png`];
  const dark = shotFiles[`../assets/${name}-dark.png`];
  const [width, height] = SIZES[name] ?? [796, 1400];
  return (
    <div className="w-full max-w-[380px] overflow-hidden rounded-[2rem] border bg-card p-2 shadow-phone">
      <div className={cn("relative overflow-hidden rounded-[1.5rem]", maxH)}>
        <img
          src={light}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          {...(priority ? { fetchPriority: "high" as const } : {})}
          className="shot-light block h-auto w-full"
        />
        <img src={dark} alt="" aria-hidden width={width} height={height} loading="lazy" decoding="async" className="shot-dark block h-auto w-full" />
        {maxH && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />}
      </div>
    </div>
  );
}

function CopyBox({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "selected">("idle");
  const codeRef = useRef<HTMLSpanElement>(null);

  const selectCode = () => {
    const el = codeRef.current;
    if (!el || !window.getSelection()) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border bg-background p-1.5 pl-3">
        <code ref={codeRef} title={value} className="min-w-0 flex-1 truncate font-mono text-sm">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(value);
              setStatus("copied");
              setTimeout(() => setStatus((s) => (s === "copied" ? "idle" : s)), 1800);
            } catch {
              selectCode();
              setStatus("selected");
            }
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-sm font-semibold hover:bg-border"
        >
          {status === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          <span>{status === "copied" ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <p aria-live="polite" className={status === "selected" ? "mt-1 text-sm text-muted-foreground" : "sr-only"}>
        {status === "copied" ? "Copied" : status === "selected" ? "Selected: press copy on your keyboard" : ""}
      </p>
    </div>
  );
}

/** Every section starts at the same left edge; `narrow` keeps a reading column of text at that edge instead of centring it. */
function Section({ id, children, className = "", narrow = false }: { id?: string; children: ReactNode; className?: string; narrow?: boolean }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8 md:py-28", className)}>
      {narrow ? <div className="max-w-3xl">{children}</div> : children}
    </section>
  );
}

const chats = [
  {
    you: "Same breakfast as yesterday.",
    claude:
      "Logged: 80 g oats, 280 g milk and a banana, 495 kcal and 22 g protein. You have 1,805 kcal and 128 g protein left today.",
  },
  {
    you: "Is my calorie goal still right?",
    claude:
      "Your logs and weigh-ins over 4 weeks show you burn about 2,810 kcal a day. To lose 0.5 kg a week that means about 2,260 kcal. Shall I update the goal?",
  },
  {
    you: "Start my full-body workout.",
    claude:
      "Barbell squat first: 2 sets of 5. Last time you did 5, 5 and 4 at 82.5 kg and hit both planned sets, so today is 85 kg.",
  },
];

type Feature = { tab: string; title: string; bullets: string[]; shot: string; alt: string; maxH?: string };
const features: Feature[] = [
  {
    tab: "Food",
    title: "Food and macros without the typing",
    bullets: [
      "Describe a meal and it is logged with calories, protein, carbs, fat, fibre, sugars and salt, from 1,381 foods in the Danish national database plus packaged products via Open Food Facts.",
      "Snap a nutrition label to add a product, or log a meal from a photo, clearly marked as an estimate.",
      "A summary card shows the day so far against your goals.",
    ],
    shot: "food",
    alt: "The summary Claude shows after logging a lunch of oats and rye bread: calories today 549 of 2,300, protein, carbs and fat against their goals, then saturated fat, trans fat, sugar, added sugar, fiber and salt, and the two foods",
  },
  {
    tab: "Your burn",
    title: "A calorie goal that learns your real burn",
    bullets: [
      "After a few weeks of logging and weigh-ins, Fitwell measures how much you actually burn.",
      "It suggests a goal from that number. Claude asks before changing anything.",
    ],
    shot: "energy",
    alt: "Energy card in the weekly review: burn a day 2,810 kcal with high confidence from 28 days and 25 weigh-ins, weight trend minus 0.54 kg a week, 2,260 kcal a day to lose 0.5 kg a week against a goal of 1,800, and the goal weight reached around 8 December",
  },
  {
    tab: "Workouts",
    title: "Workouts you start from the chat",
    bullets: [
      "A workout player inside Claude with big buttons and a rest timer.",
      "Weights suggested from your history: add 2.5 kg when every planned set hit its reps. Warm-up sets show plates per side; supersets work too.",
      "A summary with new personal bests goes back to Claude.",
    ],
    shot: "warmup",
    alt: "A warm-up set of barbell squats: warm-up 2 of 4, 5 reps at 50 kg, 15 kg each side on a 20 kg bar",
  },
  {
    tab: "Swaps",
    title: "Swap when the machine is busy",
    bullets: ["Similar exercises for the same muscles, within the equipment you have."],
    shot: "swap",
    alt: "Swap exercise opened under the barbell squat, listing dumbbell lunges, front barbell squat, bodyweight squat and dumbbell squat with their equipment, and a link to show more",
    maxH: "max-h-[520px]",
  },
  {
    tab: "3D guides",
    title: "How to do it, in 3D",
    bullets: [
      "An animated 3D body for the main lifts and many machine and cable exercises.",
      "The working muscles are tinted, with setup tips underneath.",
    ],
    shot: "guide-squat",
    alt: "The barbell squat guide: a 3D body at the bottom of a back squat with the quadriceps tinted, buttons to pause and highlight, and a legend naming the main and supporting muscles",
  },
  {
    tab: "Muscles",
    title: "Which muscles you actually train",
    bullets: ["A 3D muscle map coloured by hard sets per week, compared with the usual 10 to 20."],
    shot: "muscles",
    alt: "The muscle map for 4 weeks: a 3D body coloured by weekly hard sets, buttons for 1, 4 and 12 weeks, and a legend: not trained, under 10, 10 to 20, over 20",
  },
  {
    tab: "Meals",
    title: "A week of meals and the shopping list",
    bullets: [
      "A week planned around your goals, allergies and recipes, checked before you see it.",
      "A shopping checklist you tick off inside the chat.",
    ],
    shot: "shopping",
    alt: "The week's shopping checklist: 9 of 12 items left, grouped into sections such as Produce and Meat, with some items ticked off",
    maxH: "max-h-[520px]",
  },
  {
    tab: "Review",
    title: "A weekly review",
    bullets: ["This week next to last week, what went well and a few neutral suggestions."],
    shot: "review",
    alt: "The weekly review for 5 to 11 October: what went well, then the food tiles compared with the week before, including calories, protein, fibre, sugar, saturated fat and salt a day",
    maxH: "max-h-[520px]",
  },
];

function FeatureCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const last = features.length - 1;
  const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const goTo = (index: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(last, index));
    el.scrollTo({ left: next * el.clientWidth, behavior: reduced() ? "instant" : "smooth" });
    setActive(next);
  };

  // A resize changes the slide width but not scrollLeft: keep the active slide aligned.
  useEffect(() => {
    const realign = () => {
      const el = track.current;
      if (el) el.scrollTo({ left: active * el.clientWidth, behavior: "instant" });
    };
    window.addEventListener("resize", realign);
    return () => window.removeEventListener("resize", realign);
  }, [active]);

  useEffect(() => {
    // Centre the tab inside its own strip. scrollIntoView would also scroll the page, which jumped it down on load.
    const tab = tabs.current[active];
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    const left = strip.scrollLeft + tab.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - tab.clientWidth) / 2;
    strip.scrollTo({ left, behavior: reduced() ? "instant" : "smooth" });
  }, [active]);

  return (
    <div role="group" aria-roledescription="carousel" aria-label="What Fitwell does">
      <div className="mt-10 flex items-center gap-3">
        <div role="tablist" aria-label="Features" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {features.map((f, i) => (
            <button
              key={f.tab}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => goTo(i)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
                i === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-card",
              )}
            >
              {f.tab}
            </button>
          ))}
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          <button type="button" aria-label="Previous feature" disabled={active === 0} onClick={() => goTo(active - 1)} className="inline-flex size-10 items-center justify-center rounded-full border hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" aria-label="Next feature" disabled={active === last} onClick={() => goTo(active + 1)} className="inline-flex size-10 items-center justify-center rounded-full border hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div
        ref={track}
        tabIndex={0}
        aria-label="Feature slides. Use the left and right arrow keys."
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth > 0) setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            goTo(active + 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            goTo(active - 1);
          }
        }}
        className="mt-8 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {features.map((f, i) => (
          <article key={f.tab} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${features.length}: ${f.title}`} className="grid w-full shrink-0 snap-center items-center gap-8 md:grid-cols-2 md:gap-14">
            <div>
              <h3 className="text-2xl sm:text-3xl">{f.title}</h3>
              <ul className="mt-6 space-y-3 text-muted-foreground">
                {f.bullets.map((b) => (
                  <li key={b} className="flex gap-3 leading-relaxed">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center">
              <Phone name={f.shot} alt={f.alt} maxH={f.maxH} />
            </div>
          </article>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {`Slide ${active + 1} of ${features.length}: ${features[active]?.title ?? ""}`}
      </p>
    </div>
  );
}

const little = [
  { icon: Link2, title: "Recipes from a link", text: "Paste a link to a recipe and it is saved to your recipes." },
  { icon: Refrigerator, title: "What can I cook?", text: "Ranks your recipes by what is in the fridge." },
  { icon: TriangleAlert, title: "Allergen warnings", text: "Warnings for packaged foods that contain your allergens." },
  { icon: Sunrise, title: "A morning brief", text: "Set up a scheduled task in Claude for a daily summary." },
  { icon: Download, title: "Export or delete", text: "Take everything with you, or delete your account any time." },
];

const faqs = [
  {
    q: "Is this medical advice?",
    a: "No. Calories, burn and macros are estimates to help you plan. Talk to a doctor or dietitian for medical questions.",
  },
  {
    q: "Can I rely on the allergy checks?",
    a: "They are a help, not a guarantee. Product data can be incomplete, so always read the label.",
  },
  {
    q: "Where does the food data come from?",
    a: "Generic foods come from the Danish national food database (Frida), with English names. Packaged products come from Open Food Facts.",
  },
  {
    q: "What does it cost?",
    a: "Fitwell is free while it is invite-only.",
  },
  {
    q: "Which devices does it work on?",
    a: "It is early days. Fitwell is tested on Claude desktop, web and iPhone. Android has not been tested yet.",
  },
];

const troubles: { q: string; a: string | string[] }[] = [
  {
    q: "I didn't get a sign-in email",
    a: [
      "Only invited addresses get one. If you haven't been invited yet, ask at fitwell.fyi@pm.me.",
      "When you're invited, Cloudflare (which sends Fitwell's sign-in emails) sends you one email to confirm your address. Confirm it first, or the codes can't reach you.",
      "The code comes from login@fitwell.fyi, so check your spam folder too. It lasts 10 minutes; after that, start signing in again from Claude.",
    ],
  },
  {
    q: "The code doesn't work",
    a: "Use the code from the newest email. A code lasts 10 minutes and allows 5 tries. After that, close the sign-in window and start again from Claude for a new code.",
  },
  {
    q: "The link in the email says to type the code instead",
    a: "The link only works in the browser where you started signing in, so that nobody else can use a sign-in you didn't start. Type the 6-digit code into the Fitwell sign-in window instead.",
  },
  {
    q: "It says there were too many sign-in attempts",
    a: "Each address can ask for 5 codes an hour. Wait an hour, then sign in again from Claude.",
  },
  {
    q: "Fitwell doesn't show up in the Claude app on my phone",
    a: "Add the connector in Claude on the web or desktop first (Settings, then Connectors). It then appears in the Claude app on your phone when you're signed in to the same Claude account.",
  },
  {
    q: "Claude asks me to sign in to Fitwell again",
    a: "A sign-in stays valid while you use Fitwell and ends after 60 days without use. Sign in again from Settings, then Connectors; your data is kept.",
  },
  {
    q: "A food isn't found",
    a: "Generic foods use the English names from the Danish database, so try a plain name (\"rye bread\", \"skyr\"). For packaged food, give Claude the barcode or ask it to search Open Food Facts, which is sometimes slow. If nothing fits, Claude logs an estimate and says so.",
  },
];

function Questions({ items }: { items: { q: string; a: string | string[] }[] }) {
  return (
    <div className="mt-10 divide-y border-y">
      {items.map((f) => (
        <details key={f.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}
            <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3 space-y-2 leading-relaxed text-muted-foreground">
            {(Array.isArray(f.a) ? f.a : [f.a]).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

type ThemeMode = "auto" | "light" | "dark";
const THEME_ORDER: ThemeMode[] = ["auto", "light", "dark"];
const THEME_LABEL: Record<ThemeMode, string> = { auto: "Match system", light: "Light", dark: "Dark" };

function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("fitwell-theme");
      if (stored === "light" || stored === "dark") setMode(stored);
    } catch {
      /* storage blocked: stay on the system theme */
    }
  }, []);

  const choose = (next: ThemeMode) => {
    setMode(next);
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "auto") window.localStorage.removeItem("fitwell-theme");
      else window.localStorage.setItem("fitwell-theme", next);
    } catch {
      /* ignore */
    }
  };

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length] ?? "auto";
  return (
    <button
      type="button"
      onClick={() => choose(next)}
      aria-label={`Colour theme: ${THEME_LABEL[mode]}. Switch to ${THEME_LABEL[next]}.`}
      title={`Theme: ${THEME_LABEL[mode]}`}
      className="inline-flex size-9 items-center justify-center rounded-full border hover:bg-card"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function Index() {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <img src="/icon-512.png" alt="" width={32} height={32} className="size-8 rounded-[22%]" />
          <span>
            Fitwell <span className="font-medium text-muted-foreground max-[419px]:sr-only">for Claude</span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          <a href="#join" className="whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-semibold hover:bg-card">
            Ask for an invite
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-16 pt-10 sm:px-8 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div>
            <h1 className="text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
              Track food, training and weight by talking to Claude
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Tell Claude what you ate or start a workout from the chat. Open a dashboard when you want to see how you are
              doing.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <a href="#join" className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                Ask for an invite
              </a>
              <a href="#features" className="font-semibold text-primary underline-offset-4 hover:underline">
                See what it does <span aria-hidden>↓</span>
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Already invited?{" "}
              <a href="#connect" className="font-semibold text-foreground underline underline-offset-4">
                Connect it to Claude
              </a>
            </p>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["Invite-only", "Your Fitwell records stored in the EU", "Claude on desktop, web and iPhone"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-amber" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center md:justify-end">
            <Phone
              name="hero-squat"
              priority
              maxH="max-h-[560px]"
              alt="The workout player on Barbell Squat, set 1 of 2: last time 5, 5 and 4 reps at 82.5 kg, so today 85 kg, with reps and weight steppers and a Log set button"
            />
          </div>
        </section>

        {/* Chats */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <h2 className="text-3xl sm:text-4xl">You talk, it keeps the records.</h2>
            <div className="mt-10 max-w-3xl space-y-10">
              {chats.map((c) => (
                <div key={c.you} className="space-y-3">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-md border bg-foreground/10 px-4 py-2.5">
                      <span className="sr-only">You: </span>
                      {c.you}
                    </p>
                  </div>
                  <div className="flex justify-start">
                    <p className="max-w-[85%] rounded-2xl rounded-bl-md border bg-card px-4 py-3 leading-relaxed">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claude</span>
                      {c.claude}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-10 max-w-3xl text-sm text-muted-foreground">
              The numbers come from a made-up demo person; Claude's wording will differ.
            </p>
          </div>
        </section>

        {/* Features */}
        <Section id="features" className="pb-16 md:pb-20">
          <h2 className="max-w-2xl text-3xl sm:text-4xl">What it does</h2>
          <FeatureCarousel />
        </Section>

        {/* Little things */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <h2 className="text-3xl sm:text-4xl">And a few more</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {little.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4 rounded-xl border bg-background p-4 sm:block sm:p-5">
                  <Icon className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
                  <div>
                    <h3 className="font-bold sm:mt-4">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Roadmap */}
        <Section id="roadmap">
          <h2 className="max-w-2xl text-3xl sm:text-4xl">Where Fitwell is going</h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Pick a stage to see what is planned. Anything about friends is opt-in: nothing is shared with anyone unless you turn it on.
          </p>
          <Roadmap />
        </Section>

        {/* Data */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
          <div className="flex items-center gap-4">
            <ShieldCheck className="size-10 shrink-0 text-primary" aria-hidden />
            <h2 className="text-3xl sm:text-4xl">Your data stays yours</h2>
          </div>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            <div>
              <h3 className="font-bold">No password</h3>
              <p className="mt-2 text-muted-foreground">Sign in with a 6-digit code sent to your email.</p>
            </div>
            <div>
              <h3 className="font-bold">Stored in the EU</h3>
              <p className="mt-2 text-muted-foreground">
                Food, workouts and weigh-ins live in a database restricted to the EU. Never sold or shared, not used for ads
                or analytics.
              </p>
            </div>
            <div>
              <h3 className="font-bold">Leave any time</h3>
              <p className="mt-2 text-muted-foreground">Export or delete everything by asking Claude.</p>
            </div>
          </div>
          <p className="mt-8 max-w-3xl leading-relaxed text-muted-foreground">
            What you say in the chat is handled by Anthropic under your Claude account; Fitwell stores your records in the EU.{" "}
            <a href={PRIVACY_URL} className="font-semibold text-foreground underline underline-offset-4">
              Read the privacy notice
            </a>
            .
          </p>
          </div>
        </section>

        {/* Support */}
        {supportLinks.length > 0 && (
          <section id="support" className="scroll-mt-4">
            <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <div className="flex items-center gap-4">
              <Heart className="size-10 shrink-0 text-amber" aria-hidden />
              <h2 className="text-3xl sm:text-4xl">Support Fitwell</h2>
            </div>
            <p className="mt-6 max-w-2xl leading-relaxed text-muted-foreground">
              Fitwell is free while it is invite-only. If it is useful to you and you would like to help keep it running, you
              can chip in towards the running costs: hosting and the database, sign-in emails and the domain. It is entirely
              optional and changes nothing about what you can use.
            </p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-3">
              {supportLinks.map((l) => (
                <li key={l.name}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-full flex-col rounded-xl border bg-background p-5 hover:bg-card"
                  >
                    <span className="font-bold">{l.name}</span>
                    <span className="mt-1 text-sm text-muted-foreground">{l.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              Each link opens the provider's own page. Payments are handled by them: Fitwell never sees your payment details,
              and supporting does not change what Fitwell stores about you.
            </p>
            </div>
          </section>
        )}

        {/* Join */}
        <section id="join" className="scroll-mt-4 border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <h2 className="text-3xl sm:text-4xl">How to join</h2>
            <ol className="mt-10 max-w-3xl space-y-10">
              <Step n={1} title="Ask for an invite">
                <p>Email us from the address you want to sign in with.</p>
                <CopyBox value={EMAIL} label="email address" />
                <a
                  href="mailto:fitwell.fyi@pm.me?subject=Fitwell%20invite&body=Hi%2C%20please%20invite%20this%20address.%0A%0AI%20use%20Claude%20on%3A%20desktop%20%2F%20web%20%2F%20iPhone"
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Mail className="size-4" aria-hidden /> Open in your email app
                </a>
              </Step>
              <Step n={2} id="connect" title="Add the connector in Claude">
                <p>
                  Go to <strong className="text-foreground">Settings</strong>, then <strong className="text-foreground">Connectors</strong>,
                  then <strong className="text-foreground">Add custom connector</strong>, and paste:
                </p>
                <CopyBox value={MCP_URL} label="connector URL" />
                <p className="mt-3">It then shows up in the Claude app on your phone too.</p>
              </Step>
              <Step n={3} title="Sign in">
                <p>Claude opens the sign-in page. Enter your email, tick the consent box and type the 6-digit code.</p>
              </Step>
              <Step n={4} title="Start talking">
                <p>
                  A good first message is <span className="font-semibold text-foreground">"Set up my Fitwell profile"</span>.
                </p>
              </Step>
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <Section narrow>
          <h2 className="text-3xl sm:text-4xl">Good to know</h2>
          <Questions items={faqs} />
        </Section>

        {/* Troubleshooting */}
        <Section id="troubleshooting" narrow className="pt-0 md:pt-0">
          <h2 className="text-3xl sm:text-4xl">Troubleshooting</h2>
          <Questions items={troubles} />
          <p className="mt-8 text-muted-foreground">
            Still stuck? Email{" "}
            <a href={`mailto:${EMAIL}`} className="font-semibold text-primary underline underline-offset-4">
              {EMAIL}
            </a>{" "}
            with what you see, and we'll help.
          </p>
        </Section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl space-y-4 px-5 py-12 text-sm text-muted-foreground sm:px-8">
          <p className="font-semibold text-foreground">Screenshots show made-up demo data.</p>
          <p>
            Food data: Frida 5.5, DTU National Food Institute (CC BY 4.0), and Open Food Facts contributors (ODbL).
            Exercises: free-exercise-db (public domain). Typeface: Figtree (SIL OFL).
          </p>
          <p>Fitwell is an independent project and is not affiliated with Anthropic.</p>
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="https://mcp.fitwell.fyi/privacy" className="underline underline-offset-4 hover:text-foreground">
              Privacy notice
            </a>
            <a href={`mailto:${EMAIL}`} className="underline underline-offset-4 hover:text-foreground">
              {EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, id, title, children }: { n: number; id?: string; title: string; children: ReactNode }) {
  return (
    <li id={id} className="grid scroll-mt-8 grid-cols-[2.5rem_minmax(0,1fr)] gap-4">
      <span className="flex size-10 items-center justify-center rounded-full border-2 border-primary font-bold text-primary" aria-hidden>
        {n}
      </span>
      <div>
        <h3 className="text-xl">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <div className="mt-2 leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
