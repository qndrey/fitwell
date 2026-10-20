import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";

const prefersReduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fades sections in as they scroll into view. Content stays visible without JS or with reduced motion. */
export function useReveal() {
  useEffect(() => {
    if (prefersReduced() || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    root.classList.add("motion-ok");
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("motion-ok");
    };
  }, []);
}

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#join", label: "Join" },
];

export function SiteHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [current, setCurrent] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(`#${e.target.id}`);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    NAV.forEach((n) => {
      const el = document.querySelector(n.href);
      if (el) io.observe(el);
    });
    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
    };
  }, []);

  return (
    <header className={cn("sticky top-0 z-40 border-b transition-colors duration-300", scrolled ? "border-border bg-background/75 backdrop-blur-xl" : "border-transparent")}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <a href="#top" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <img src="/icon-512.png" alt="" width={32} height={32} className="size-8 rounded-[22%]" />
          <span>
            Fitwell <span className="font-medium text-muted-foreground max-[419px]:sr-only">for Claude</span>
          </span>
        </a>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1 rounded-full border bg-card/60 p-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <a
                  href={n.href}
                  aria-current={current === n.href ? "true" : undefined}
                  className={cn(
                    "block rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                    current === n.href ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

/** Tilts its content gently towards the pointer on devices with a fine pointer. */
export function Tilt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(!prefersReduced() && window.matchMedia("(pointer: fine)").matches);
  }, []);
  const reset = () => {
    if (ref.current) ref.current.style.transform = "";
  };
  return (
    <div
      className={cn("[perspective:1200px]", className)}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!enabled || !el) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
      }}
      onPointerLeave={reset}
    >
      <div ref={ref} className="transition-transform duration-300 ease-out [transform-style:preserve-3d]">
        {children}
      </div>
    </div>
  );
}

type Chat = { you: string; claude: string };

/** The three chat exchanges, played one after another when they scroll into view. All text is in the page from the start. */
export function ChatDemo({ chats }: { chats: Chat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const total = chats.length * 2;
  const [step, setStep] = useState(total); // fully shown until JS decides otherwise
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (prefersReduced() || !ref.current) return;
    setStep(0);
    let timers: number[] = [];
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        let t = 200;
        for (let i = 0; i < total; i++) {
          const isClaude = i % 2 === 1;
          if (isClaude) {
            timers.push(window.setTimeout(() => setTyping(true), t));
            t += 900;
          }
          timers.push(
            window.setTimeout(() => {
              setTyping(false);
              setStep(i + 1);
            }, t),
          );
          t += isClaude ? 700 : 450;
        }
      },
      { threshold: 0.25 },
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
      timers = [];
    };
  }, [total]);

  const shown = (i: number) => step > i;
  const bubble = "transition-all duration-500 ease-out";
  const hidden = "translate-y-3 opacity-0";

  return (
    <div ref={ref} className="space-y-8">
      {chats.map((c, n) => (
        <div key={c.you} className="space-y-3">
          <div className="flex justify-end">
            <p className={cn("max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground", bubble, !shown(n * 2) && hidden)}>
              <span className="sr-only">You: </span>
              {c.you}
            </p>
          </div>
          <div className="relative flex justify-start">
            {typing && step === n * 2 + 1 && (
              <span aria-hidden className="absolute left-0 top-0 inline-flex gap-1 rounded-2xl rounded-bl-md border bg-background px-4 py-3.5">
                {[0, 1, 2].map((d) => (
                  <span key={d} className="typing-dot size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 150}ms` }} />
                ))}
              </span>
            )}
            <p className={cn("max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-4 py-3 leading-relaxed shadow-sm", bubble, !shown(n * 2 + 1) && hidden)}>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber">Claude</span>
              {c.claude}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => window.scrollTo({ top: 0, behavior: prefersReduced() ? "instant" : "smooth" })}
      className={cn(
        "fixed bottom-5 right-5 z-40 inline-flex size-11 items-center justify-center rounded-full border bg-background/90 shadow-phone backdrop-blur transition-all duration-300 hover:bg-card",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}
