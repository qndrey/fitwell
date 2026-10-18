import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, type ReactNode } from "react";
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
  ShieldCheck,
} from "lucide-react";

import hero from "@/assets/hero-squat.png.asset.json";
import nutrition from "@/assets/nutrition.png.asset.json";
import energy from "@/assets/energy.png.asset.json";
import warmup from "@/assets/warmup.png.asset.json";
import summary from "@/assets/player-summary.png.asset.json";
import swap from "@/assets/swap.png.asset.json";
import guide from "@/assets/guide-squat-dark.png.asset.json";
import muscles from "@/assets/muscles-light.png.asset.json";
import shopping from "@/assets/shopping-light.png.asset.json";
import review from "@/assets/review-light.png.asset.json";

const TITLE = "Fitwell for Claude";
const DESC =
  "A fitness and nutrition coach inside Claude. Log food, plan meals, run workouts and see your progress by talking to Claude. Invite-only, data stored in the EU.";
const OG_IMAGE = `https://fitwell.fyi${hero.url}`;
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
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: "https://fitwell.fyi/" }],
  }),
  component: Index,
});

function Phone({ src, alt, maxH = "max-h-[640px]" }: { src: string; alt: string; maxH?: string }) {
  return (
    <div className={`w-full max-w-[320px] overflow-hidden rounded-[2rem] border bg-card p-2 shadow-phone`}>
      <div className={`overflow-hidden rounded-[1.5rem] ${maxH}`}>
        <img src={src} alt={alt} loading="lazy" className="block h-auto w-full" />
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
        <code ref={codeRef} className="min-w-0 flex-1 truncate font-mono text-sm">
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

function Section({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto max-w-6xl scroll-mt-8 px-5 py-20 sm:px-8 md:py-28 ${className}`}>
      {children}
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
      "Your logs and weigh-ins over 4 weeks show you burn about 2,940 kcal a day. To lose 0.5 kg a week that means about 2,390 kcal. Shall I update the goal?",
  },
  {
    you: "Start Workout A. The squat rack is taken.",
    claude:
      "Swapped the back squat for the leg press and kept your 3 sets of 8. Last time you hit every rep at 120 kg, so today is 122.5 kg.",
  },
];

type Feature = { title: string; bullets: string[]; images: { src: string; alt: string }[] };
const features: Feature[] = [
  {
    title: "Food and macros without the typing",
    bullets: [
      "Describe a meal and it is logged with calories, protein, carbs and fat, from 1,381 foods in the Danish national database plus packaged products via Open Food Facts.",
      "Snap a nutrition label to add a product.",
      "Log a meal from a photo, clearly marked as an estimate.",
    ],
    images: [{ src: nutrition.url, alt: "Nutrition card: daily calories over 90 days against a goal line, within 10 percent of the goal on 53 of 81 logged days and the protein goal reached on 75" }],
  },
  {
    title: "A calorie goal that learns your real burn",
    bullets: [
      "After a few weeks of logging and weigh-ins, Fitwell measures how much you actually burn.",
      "It suggests a goal from that number. Claude asks before changing anything.",
    ],
    images: [{ src: energy.url, alt: "Energy card in the weekly review: burn about 2,940 kcal a day with high confidence from 24 days and 23 weigh-ins, weight trend minus 0.67 kg a week, and 2,390 kcal a day to lose 0.5 kg a week" }],
  },
  {
    title: "Workouts you start from the chat",
    bullets: [
      "A workout player inside Claude with big buttons and a rest timer.",
      "Weights suggested from your history: add 2.5 kg when every set hit its reps. Warm-up sets show plates per side; supersets work too.",
      "A summary with new personal bests goes back to Claude.",
    ],
    images: [
      { src: warmup.url, alt: "A warm-up set of barbell squats: warm-up 2 of 4, 5 reps at 50 kg, 15 kg each side on a 20 kg bar" },
      { src: summary.url, alt: "The finished workout summary: 45 minutes, 1,355 kg lifted and a new best estimated one-rep max for the squat" },
    ],
  },
  {
    title: "Swap when the machine is busy",
    bullets: ["Similar exercises for the same muscles, within the equipment you have."],
    images: [{ src: swap.url, alt: "Swap exercise opened under the barbell squat, listing dumbbell lunges, front squat, bodyweight squat, dumbbell squat and more, each with its equipment" }],
  },
  {
    title: "How to do it, in 3D",
    bullets: [
      "An animated 3D body for the main lifts and many machine and cable exercises.",
      "The working muscles are tinted, with setup tips underneath.",
    ],
    images: [{ src: guide.url, alt: "The barbell squat guide in the dark theme: a 3D body at the bottom of a back squat with the thighs and glutes tinted" }],
  },
  {
    title: "Which muscles you actually train",
    bullets: ["A 3D muscle map coloured by hard sets per week, compared with the usual 10 to 20."],
    images: [{ src: muscles.url, alt: "The muscle map for 4 weeks: a 3D body coloured by weekly hard sets, a legend, and every muscle listed with its sets per week" }],
  },
  {
    title: "A week of meals and the shopping list",
    bullets: [
      "A week planned around your goals, allergies and recipes, checked before you see it.",
      "A shopping checklist you tick off inside the chat.",
    ],
    images: [{ src: shopping.url, alt: "The week's shopping checklist: 9 of 12 items left, grouped into Produce, Meat, Fish, Dairy and Pantry, with three items ticked off" }],
  },
  {
    title: "A weekly review",
    bullets: ["This week next to last week, what went well and a few neutral suggestions."],
    images: [{ src: review.url, alt: "The weekly review for 5 to 11 October: what went well, then food, training, body and sleep tiles compared with the week before" }],
  },
];

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
    q: "Which devices does it work on?",
    a: "It is early days. Fitwell is tested on Claude desktop, web and iPhone. Android has not been tested yet.",
  },
];

const troubles = [
  {
    q: "I didn't get a sign-in email",
    a: "Only invited addresses get one; if you haven't been invited yet, ask at fitwell.fyi@pm.me. When you're invited, Cloudflare (which sends Fitwell's sign-in emails) sends you one email to confirm your address: confirm it first, or the codes can't reach you. The code comes from login@fitwell.fyi, so check your spam folder too. It lasts 10 minutes; after that, start signing in again from Claude.",
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

function Questions({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="mt-10 divide-y border-y">
      {items.map((f) => (
        <details key={f.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}
            <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-3 leading-relaxed text-muted-foreground">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

function Index() {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <span className="text-lg font-bold tracking-tight">
          Fitwell <span className="font-medium text-muted-foreground">for Claude</span>
        </span>
        <a href="#join" className="rounded-full border px-4 py-1.5 text-sm font-semibold hover:bg-card">
          Ask for an invite
        </a>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-16 pt-10 sm:px-8 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div>
            <h1 className="text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
              Track food, training and weight by talking to Claude
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Tell Claude what you ate, ask it to plan your week, start a workout from the chat and open a dashboard when
              you want to see how you are doing.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <a href="#join" className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                Ask for an invite
              </a>
              <a href="#features" className="font-semibold text-primary underline-offset-4 hover:underline">
                See what it does ↓
              </a>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["Claude on desktop, web and iPhone", "Health data stored in the EU", "Invite-only"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-amber" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center md:justify-end">
            <Phone src={hero.url} alt="The workout player showing Barbell Squat, set 1 of 2: last time 2 by 5 at 85 kg, so today 87.5 kg, with a Log set button" maxH="max-h-[600px]" />
          </div>
        </section>

        {/* Chats */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 md:py-24">
            <h2 className="text-3xl sm:text-4xl">You talk, it keeps the records.</h2>
            <div className="mt-12 space-y-10">
              {chats.map((c) => (
                <div key={c.you} className="space-y-3">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
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
            <p className="mt-10 text-sm text-muted-foreground">
              Numbers come from the demo person in the screenshots; Claude's wording will differ.
            </p>
          </div>
        </section>

        {/* Features */}
        <Section id="features">
          <h2 className="max-w-2xl text-3xl sm:text-4xl">What it does</h2>
          <div className="mt-16 space-y-24 md:space-y-32">
            {features.map((f, i) => (
              <article key={f.title} className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
                <div className={i % 2 ? "md:order-2" : ""}>
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
                <div className={`flex justify-center gap-4 ${i % 2 ? "md:order-1" : ""}`}>
                  {f.images.map((img) => (
                    <Phone key={img.src} src={img.src} alt={img.alt} maxH={f.images.length > 1 ? "max-h-[420px]" : "max-h-[560px]"} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Section>

        {/* Little things */}
        <section className="border-y bg-card/50">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <h2 className="text-3xl sm:text-4xl">Little things</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {little.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-xl border bg-background p-5">
                  <Icon className="size-5 text-amber" aria-hidden />
                  <h3 className="mt-4 font-bold">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Data */}
        <Section>
          <div className="grid gap-10 md:grid-cols-[auto_1fr] md:gap-16">
            <ShieldCheck className="size-10 text-primary" aria-hidden />
            <div>
              <h2 className="text-3xl sm:text-4xl">Your data stays yours</h2>
              <div className="mt-8 grid gap-8 sm:grid-cols-3">
                <div>
                  <h3 className="font-bold">No password</h3>
                  <p className="mt-2 text-muted-foreground">Sign in with a 6-digit code sent to your email.</p>
                </div>
                <div>
                  <h3 className="font-bold">Stored in the EU</h3>
                  <p className="mt-2 text-muted-foreground">
                    Food, workouts and weigh-ins live in a database restricted to the EU. Never sold or shared, not used for
                    ads or analytics.
                  </p>
                </div>
                <div>
                  <h3 className="font-bold">Leave any time</h3>
                  <p className="mt-2 text-muted-foreground">Export or delete everything by asking Claude.</p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Join */}
        <section id="join" className="scroll-mt-4 border-y bg-card/50">
          <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 md:py-28">
            <h2 className="text-3xl sm:text-4xl">How to join</h2>
            <ol className="mt-12 space-y-10">
              <Step n={1} title="Ask for an invite">
                <p>Email us from the address you want to sign in with.</p>
                <CopyBox value={EMAIL} label="email address" />
                <a
                  href="mailto:fitwell.fyi@pm.me?subject=Fitwell%20invite"
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Mail className="size-4" aria-hidden /> Open in your email app
                </a>
              </Step>
              <Step n={2} title="Add the connector in Claude">
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
        <Section className="max-w-3xl">
          <h2 className="text-3xl sm:text-4xl">Good to know</h2>
          <Questions items={faqs} />
        </Section>

        {/* Troubleshooting */}
        <Section id="troubleshooting" className="max-w-3xl pt-0 md:pt-0">
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

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-4">
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
