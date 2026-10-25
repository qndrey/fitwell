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
  KeyRound,
  MapPin,
  CircleHelp,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Roadmap } from "@/components/roadmap";
import { BackToTop, ChatDemo, HeroCanvas, SiteHeader, Tilt, useReveal } from "@/components/landing-extras";

// Every screenshot exists in a light and a dark version (<name>-light.png, <name>-dark.png), taken from the
// real views by apps/mcp/scripts/screenshots.ts. The page theme picks one.
const shotFiles = import.meta.glob<string>("../assets/*-{light,dark}.png", { eager: true, import: "default" });
// The demo videos (webm, light and dark): the page theme picks one, like the screenshots. Their first screen is the poster.
const videoFiles = import.meta.glob<string>("../assets/*.webm", { eager: true, import: "default", query: "?url" });
// Pixel sizes of the screenshots, so the page reserves their space. Update them when you re-shoot.
const SIZES: Record<string, [number, number]> = {
  "demo-workout-poster": [796, 1200],
  food: [796, 994],
  energy: [796, 1216],
  warmup: [796, 1166],
  swap: [796, 1466],
  "guide-squat": [796, 1000],
  muscles: [796, 1010],
  dashboard: [796, 1216],
  lift: [796, 1836],
  shopping: [796, 1200],
  review: [796, 1216],
};

const TITLE = "Fitwell";
const DESC =
  "A fitness and nutrition coach inside your AI assistant. Log food, plan meals, run workouts and see your progress by talking to your assistant. Invite-only, data stored in the EU.";
const OG_IMAGE = "https://fitwell.fyi/og.png";
const OG_ALT = "Fitwell: train smarter and get stronger by talking to your assistant";
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
const EMAIL = "hello@fitwell.fyi";
const MCP_URL = "https://mcp.fitwell.fyi/mcp";
/** The invite form posts here with fetch and reads a JSON answer (the server allows this page's origins). */
const REQUEST_ACCESS_URL = "https://mcp.fitwell.fyi/request-access";

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

/** Whether the page shows its dark theme: the person's choice (data-theme) or else the system's. Starts light, as the prerendered page does. */
function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const t = document.documentElement.getAttribute("data-theme");
      setDark(t === "dark" || (t !== "light" && mq.matches));
    };
    read();
    mq.addEventListener("change", read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", read);
      mo.disconnect();
    };
  }, []);
  return dark;
}

type DemoVideoProps = { name: string; active: boolean; playing: boolean; onEnded: () => void };

/**
 * A demo video laid over its poster (the poster is the first screen, so nothing jumps). It exists only in the browser, after the page
 * has loaded: the prerendered page has the poster alone. It plays muted from its start when its slide is shown and `playing`, holds
 * where it is when only `playing` ends (paused), and goes back to the start when its slide is left.
 */
function DemoVideo({ name, active, playing, onEnded }: DemoVideoProps) {
  const dark = useDark();
  const ref = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => setMounted(true), []);
  const src = videoFiles[`../assets/${name}-${dark ? "dark" : "light"}.webm`];
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!active) {
      v.pause();
      v.currentTime = 0;
      setShown(false);
    } else if (playing) void v.play().catch(() => undefined);
    else v.pause();
  }, [mounted, active, playing, src]);
  if (!mounted || !src) return null;
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload={active ? "auto" : "none"}
      aria-hidden
      tabIndex={-1}
      onPlaying={() => setShown(true)}
      onEnded={onEnded}
      className={cn("absolute inset-0 block h-full w-full object-cover transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}
    />
  );
}

function Phone({ name, alt, priority = false, maxH, video }: { name: string; alt: string; priority?: boolean; maxH?: string | undefined; video?: DemoVideoProps }) {
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
        {video && <DemoVideo {...video} />}
        {maxH && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />}
      </div>
    </div>
  );
}

const HERO_SLIDES: { name: string; label: string; alt: string; video?: string }[] = [
  {
    name: "demo-workout-poster",
    label: "Workout demo",
    video: "demo-workout",
    alt: "A short demo of a full-body workout in the player: start with the squat, log a set, rest, move on through the pull-ups and bench press, then finish with a summary that includes a new best",
  },
];

function HeroRotator() {
  const slides: { name: string; label: string; alt: string; video?: string }[] = [...HERO_SLIDES, ...features.map((f) => ({ name: f.shot, label: f.tab, alt: f.alt }))];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);
  const next = () => setI((n) => (n + 1) % slides.length);
  // A still is shown for a few seconds; the demo video is shown for as long as it plays and then hands over to the next slide.
  const onVideo = !!slides[i]?.video;
  useEffect(() => {
    if (paused || hover || onVideo) return;
    const t = window.setInterval(next, 3800);
    return () => window.clearInterval(t);
  }, [paused, hover, onVideo, slides.length]);
  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Fitwell screens"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <div className="grid">
        {slides.map((s, n) => (
          <div
            key={s.name}
            aria-hidden={n !== i}
            className={cn("col-start-1 row-start-1 transition-all duration-700 ease-out", n === i ? "opacity-100" : "pointer-events-none scale-[0.97] opacity-0")}
          >
            <Phone name={s.name} alt={s.alt} priority={n === 0} maxH="max-h-[560px]" {...(s.video ? { video: { name: s.video, active: n === i, playing: n === i && !paused, onEnded: () => !paused && next() } } : {})} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play screen rotation" : "Pause screen rotation"}
          className="inline-flex size-8 items-center justify-center rounded-full border bg-background/80 text-xs hover:bg-card"
        >
          <span aria-hidden>{paused ? "▶" : "❚❚"}</span>
        </button>
        <div className="flex gap-1.5">
          {slides.map((s, n) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show ${s.label}`}
              aria-current={n === i ? "true" : undefined}
              className={cn("h-2 rounded-full transition-all", n === i ? "w-6 bg-amber" : "w-2 bg-border hover:bg-muted-foreground")}
            />
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{paused ? `Showing ${slides[i]?.label}` : ""}</p>
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
    assistant:
      "Logged: 80 g oats, 280 g milk and a banana, 495 kcal and 22 g protein. You have 1,805 kcal and 128 g protein left today.",
  },
  {
    you: "Is my calorie goal still right?",
    assistant:
      "Your logs and weigh-ins over 4 weeks show you burn about 2,810 kcal a day. To lose 0.5 kg a week that means about 2,260 kcal. Shall I update the goal?",
  },
  {
    you: "Start my full-body workout.",
    assistant:
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
    alt: "The summary the assistant shows after logging a lunch of oats and rye bread: calories today 549 of 2,300, protein, carbs and fat against their goals, then saturated fat, trans fat, sugar, added sugar, fiber and salt, and the two foods",
  },
  {
    tab: "Your burn",
    title: "A calorie goal that learns your real burn",
    bullets: [
      "After a few weeks of logging and weigh-ins, Fitwell measures how much you actually burn.",
      "It suggests a goal from that number. The assistant asks before changing anything.",
    ],
    shot: "energy",
    alt: "The weekly review on its Energy card: burn a day 2,810 kcal from 28 days and 25 weigh-ins, weight trend minus 0.54 kg a week, 2,260 kcal a day to lose 0.5 kg a week against a goal of 1,800, and the goal weight reached around 8 December",
  },
  {
    tab: "Workouts",
    title: "Workouts you start from the chat",
    bullets: [
      "A workout player inside the chat with big buttons and a rest timer.",
      "Weights suggested from your history: add 2.5 kg when every planned set hit its reps. Warm-up sets show plates per side; supersets work too.",
      "A summary with new personal bests goes back to the assistant.",
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
    tab: "Progress",
    title: "Your progress on one screen",
    bullets: [
      "Weight, nutrition, burn, training, strength, habits and measurements: one card each, with an icon to jump to it or a swipe.",
      "Trends use the 7-day average, so a single weigh-in does not move the line. Pick 30 days, 90 days or a year.",
    ],
    shot: "dashboard",
    alt: "The progress dashboard for 90 days: weight trend 82.6 kg, down 5.5 kg since 28 July, with the weigh-ins, the 7-day average and the goal of 78.5 kg on a chart, and a row of icon tabs for the other cards",
    maxH: "max-h-[560px]",
  },
  {
    tab: "Strength",
    title: "Strength you can see",
    bullets: [
      "An estimated one-rep max for each lift, with a mark on every new best.",
      "Your rep records and your last sessions, lift by lift.",
    ],
    shot: "lift",
    alt: "Barbell bench press progress: an estimated one-rep max of 78.8 kg as a rising line with a diamond on every new best, then the rep records and the last sessions",
    maxH: "max-h-[520px]",
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
    alt: "The weekly review for 5 to 11 October: the week's calories, workouts and weigh-ins, then a row of icon tabs and the what-went-well card",
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
  { icon: Sunrise, title: "A morning brief", text: "Set up a scheduled task in your assistant for a daily summary." },
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
    q: "Can I invite a friend?",
    a: "If you already use Fitwell regularly, yes: ask your assistant to invite a friend by email address. Your friend gets one email saying you invited them and how to connect. There are a few invitations each month, so it is not for everyone at once.",
  },
  {
    q: "What does it cost?",
    a: "Fitwell is free while it is invite-only.",
  },
  {
    q: "Which devices does it work on?",
    a: "It is early days. Fitwell is a standard connector and has been tested in Claude, ChatGPT and Cursor. Android has not been tested yet.",
  },
];

const troubles: { q: string; a: string | string[] }[] = [
  {
    q: "I didn't get a sign-in email",
    a: [
      "Only invited addresses get one. If you haven't been invited yet, ask for one with the form in How to join, above.",
      "The code comes from login@fitwell.fyi, so check your spam folder too. It lasts 10 minutes; after that, start signing in again from your assistant.",
    ],
  },
  {
    q: "The code doesn't work",
    a: "Use the code from the newest email. A code lasts 10 minutes and allows 5 tries. After that, close the sign-in window and start again from your assistant for a new code.",
  },
  {
    q: "The link in the email says to type the code instead",
    a: "The link only works in the browser where you started signing in, so that nobody else can use a sign-in you didn't start. Type the 6-digit code into the Fitwell sign-in window instead.",
  },
  {
    q: "It says there were too many sign-in attempts",
    a: "Each address can ask for 5 codes an hour. Wait an hour, then sign in again from your assistant.",
  },
  {
    q: "Fitwell doesn't show up in the app on my phone",
    a: "Add the connector on the web or desktop first (Settings, then Connectors). It then appears in the app on your phone when you're signed in to the same account.",
  },
  {
    q: "My assistant asks me to sign in to Fitwell again",
    a: "A sign-in stays valid while you use Fitwell and ends after 60 days without use. Sign in again from Settings, then Connectors; your data is kept.",
  },
  {
    q: "A food isn't found",
    a: "Generic foods use the English names from the Danish database, so try a plain name (\"rye bread\", \"skyr\"). For packaged food, give the assistant the barcode or ask it to search Open Food Facts, which is sometimes slow. If nothing fits, it logs an estimate and says so.",
  },
];

// Staggered reveal for the "And a few more" cards. Classes, not a style attribute: the CSP blocks inline styles.
const REVEAL_DELAYS = ["[--d:0ms]", "[--d:70ms]", "[--d:140ms]", "[--d:210ms]", "[--d:280ms]"];

function Questions({ items }: { items: { q: string; a: string | string[] }[] }) {
  return (
    <div className="mt-8 space-y-3">
      {items.map((f) => (
        <details key={f.q} className="group rounded-2xl border bg-card/40 px-5 transition-colors open:bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background" aria-hidden>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="space-y-2 pb-5 leading-relaxed text-muted-foreground">
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
  useReveal();
  return (
    <div id="top" className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <SiteHeader>
        <a href="#join" className="whitespace-nowrap rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          Ask for an invite
        </a>
        <ThemeToggle />
      </SiteHeader>

      <main id="main">
        {/* Hero */}
        <div className="relative overflow-hidden">
          <div aria-hidden className="hero-backdrop pointer-events-none absolute inset-0" />
          <HeroCanvas />
          <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 md:grid-cols-[1.2fr_1fr] md:pb-28 md:pt-20">
            <div data-reveal>
              <h1 className="text-[2.6rem] leading-[1.02] sm:text-6xl lg:text-7xl">
                Train smarter and get stronger by <span className="text-amber">talking to your assistant</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
                Tell your assistant what you ate or start a workout from the chat. Open a dashboard when you want to see how you are
                doing.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-5">
                <a href="#join" className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 font-semibold text-primary-foreground shadow-phone transition-transform hover:-translate-y-0.5">
                  Ask for an invite
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
                </a>
                <a href="#features" className="font-semibold text-foreground underline-offset-4 hover:underline">
                  See what it does <span aria-hidden>↓</span>
                </a>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Already invited?{" "}
                <a href="#connect" className="font-semibold text-foreground underline underline-offset-4">
                  Connect it to your assistant
                </a>
              </p>
              <ul className="mt-10 flex flex-wrap gap-2 text-sm">
                {["Invite-only", "Your Fitwell records stored in the EU", "Works in Claude, ChatGPT and Cursor"].map((f) => (
                  <li key={f} className="flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5 text-muted-foreground backdrop-blur">
                    <span className="size-1.5 rounded-full bg-amber" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative flex justify-center md:justify-end" data-reveal>
              <Tilt className="w-full max-w-[380px]">
                <HeroRotator />
              </Tilt>
            </div>
          </section>
        </div>

        {/* Chats */}
        <section className="border-y bg-card/50">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-[1fr_1.4fr] md:py-28">
            <div data-reveal className="md:sticky md:top-28 md:self-start">
              <h2 className="text-3xl sm:text-5xl">You talk, it keeps the records.</h2>
              <p className="mt-6 max-w-sm text-sm text-muted-foreground">
                The numbers come from a made-up demo person; your assistant's wording will differ.
              </p>
            </div>
            <ChatDemo chats={chats} />
          </div>
        </section>

        {/* Features */}
        <Section id="features" className="pb-16 md:pb-20">
          <div data-reveal>
            <h2 className="max-w-2xl text-3xl sm:text-5xl">What it does</h2>
            <FeatureCarousel />
          </div>
        </Section>

        {/* Little things */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 md:py-28">
            <h2 className="text-3xl sm:text-5xl" data-reveal>And a few more</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {little.map(({ icon: Icon, title, text }, i) => (
                <li
                  key={title}
                  data-reveal
                  className={cn(REVEAL_DELAYS[i], "group flex gap-4 rounded-2xl border bg-background p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-phone sm:block sm:p-5")}
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber/10 transition-colors group-hover:bg-amber/20">
                    <Icon className="size-5 text-amber" aria-hidden />
                  </span>
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
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm font-semibold">
                  <ShieldCheck className="size-4 text-amber" aria-hidden /> Privacy
                </span>
                <h2 className="mt-4 text-3xl sm:text-5xl">Your data stays yours</h2>
              </div>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              <DataCard icon={<KeyRound className="size-5" />} title="No password">
                Sign in with a 6-digit code sent to your email.
              </DataCard>
              <DataCard icon={<MapPin className="size-5" />} title="Stored in the EU">
                Food, workouts and weigh-ins live in a database restricted to the EU. Never sold or shared, not used for ads or
                analytics.
              </DataCard>
              <DataCard icon={<Download className="size-5" />} title="Leave any time">
                Export or delete everything by asking your assistant.
              </DataCard>
            </div>
            <p className="mt-8 max-w-3xl rounded-2xl border-l-4 border-amber bg-background px-5 py-4 leading-relaxed text-muted-foreground">
              What you say in the chat is handled by Anthropic under your assistant account; Fitwell stores your records in the EU.{" "}
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
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-sm font-semibold uppercase tracking-wide text-amber">Four steps, a few minutes</p>
              <h2 className="mt-3 text-3xl sm:text-5xl">How to join</h2>
              <p className="mt-5 max-w-sm leading-relaxed text-muted-foreground">
                Ask for an invite, add the connector, sign in with a code and say hello.
              </p>
            </div>
            <ol className="space-y-8">
              <Step n={1} title="Ask for an invite">
                <p>Leave the email address you want to sign in with. We look at each request, and once yours is approved we email you how to connect.</p>
                <InviteForm />
                <p className="mt-4 text-sm">Know someone who already uses Fitwell? They can invite you from their assistant instead.</p>
                <p className="mt-4 text-sm">Prefer email? Write to us from that address:</p>
                <CopyBox value={EMAIL} label="email address" />
              </Step>
              <Step n={2} id="connect" title="Add the connector">
                <p>
                  Go to <strong className="text-foreground">Settings</strong>, then <strong className="text-foreground">Connectors</strong>,
                  then <strong className="text-foreground">Add custom connector</strong>, and paste:
                </p>
                <CopyBox value={MCP_URL} label="connector URL" />
                <p className="mt-3">It then shows up in the app on your phone too.</p>
              </Step>
              <Step n={3} title="Sign in">
                <p>Your assistant opens the sign-in page. Enter your email, tick the consent box and type the 6-digit code.</p>
              </Step>
              <Step n={4} title="Start talking" last>
                <p>
                  A good first message is <span className="font-semibold text-foreground">"Set up my Fitwell profile"</span>.
                </p>
              </Step>
            </ol>
          </div>
        </section>

        {/* FAQ + Troubleshooting */}
        <section className="mx-auto grid max-w-6xl gap-14 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-2 lg:gap-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-card text-amber" aria-hidden>
                <CircleHelp className="size-5" />
              </span>
              <h2 className="text-3xl sm:text-4xl">Good to know</h2>
            </div>
            <Questions items={faqs} />
          </div>
          <div id="troubleshooting" className="scroll-mt-24">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-card text-amber" aria-hidden>
                <Wrench className="size-5" />
              </span>
              <h2 className="text-3xl sm:text-4xl">Troubleshooting</h2>
            </div>
            <Questions items={troubles} />
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-dashed p-5 text-muted-foreground">
              <Mail className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
              <p>
                Still stuck? Email{" "}
                <a href={`mailto:${EMAIL}`} className="font-semibold text-foreground underline underline-offset-4">
                  {EMAIL}
                </a>{" "}
                with what you see, and we'll help.
              </p>
            </div>
          </div>
        </section>
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
      <BackToTop />
    </div>
  );
}

/**
 * The invite request, sent from this page so the visitor never leaves it. The fields match the form at
 * mcp.fitwell.fyi/request-access (apps/mcp/src/auth/requestAccess.ts), which answers this page in JSON.
 */
function InviteForm() {
  const [state, setState] = useState<{ kind: "idle" | "sending" } | { kind: "done"; message: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const field = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  if (state.kind === "done") {
    return (
      <div role="status" className="mt-4 flex gap-3 rounded-xl border bg-card p-4 text-foreground">
        <Check className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
        <p>
          <strong>Thanks.</strong> {state.message}
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: "sending" });
        try {
          const res = await fetch(REQUEST_ACCESS_URL, {
            method: "POST",
            headers: { Accept: "application/json" },
            body: new FormData(e.currentTarget),
          });
          const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
          if (res.ok && data?.ok) setState({ kind: "done", message: data.message ?? "" });
          else setState({ kind: "error", message: data?.error ?? `Something went wrong. Try again, or write to ${EMAIL}.` });
        } catch {
          setState({ kind: "error", message: `Could not reach Fitwell. Check your connection and try again, or write to ${EMAIL}.` });
        }
      }}
    >
      <div>
        <label htmlFor="invite-email" className="text-sm font-semibold text-foreground">
          Your email
        </label>
        <input id="invite-email" type="email" name="email" autoComplete="email" required maxLength={254} className={field} />
      </div>
      <div>
        <label htmlFor="invite-platform" className="text-sm font-semibold text-foreground">
          Where you will use it <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <select id="invite-platform" name="platform" defaultValue="" className={field}>
          <option value="">Not sure yet</option>
          <option value="desktop">A desktop app</option>
          <option value="web">A website</option>
          <option value="iphone">iPhone</option>
        </select>
      </div>
      {/* A person never sees this field; the server quietly drops a request that fills it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Leave this empty <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex items-start gap-2.5">
        <input id="invite-consent" type="checkbox" name="consent" value="yes" required className="mt-1 size-4 shrink-0 accent-primary" />
        <label htmlFor="invite-consent" className="text-sm">
          Keep my email address until you have answered (at most 30 days) so you can approve or decline it.{" "}
          <a href={PRIVACY_URL} className="font-semibold text-foreground underline underline-offset-4">
            Privacy notice
          </a>
        </label>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="flex gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={state.kind === "sending"}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        <Mail className="size-4" aria-hidden /> {state.kind === "sending" ? "Sending…" : "Ask for an invite"}
      </button>
    </form>
  );
}

function Step({ n, id, title, children, last = false }: { n: number; id?: string; title: string; children: ReactNode; last?: boolean }) {
  return (
    <li id={id} className="relative grid scroll-mt-24 grid-cols-[3rem_minmax(0,1fr)] gap-5">
      {!last && <span aria-hidden className="absolute left-6 top-14 bottom-[-2rem] w-px -translate-x-1/2 bg-border" />}
      <span
        className="relative z-10 flex size-12 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-phone"
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0 rounded-2xl border bg-background p-5 sm:p-6">
        <h3 className="text-xl">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <div className="mt-2 leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function DataCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border bg-background p-6 transition-transform duration-300 hover:-translate-y-1">
      <span className="flex size-11 items-center justify-center rounded-xl bg-card text-amber" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-5 text-lg font-bold">{title}</h3>
      <p className="mt-2 leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
