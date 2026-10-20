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
          <span>Fitwell</span>
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

type Orb = { x: number; y: number; r: number; vx: number; vy: number; hue: 0 | 1; phase: number };
type Ripple = { x: number; y: number; t: number };
type Spark = { x: number; y: number; vx: number; vy: number; t: number; hue: 0 | 1 };

/** Abstract hero backdrop: soft drifting orbs; a click sends out a ripple with a few sparks. */
export function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReduced();
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let visible = true;

    const colors = (): [string, string] => {
      const s = getComputedStyle(document.documentElement);
      return [s.getPropertyValue("--amber").trim() || "#c2603f", s.getPropertyValue("--primary").trim() || "#5a5650"];
    };

    const orbs: Orb[] = [];
    const ripples: Ripple[] = [];
    const sparks: Spark[] = [];

    const seed = () => {
      orbs.length = 0;
      const n = Math.max(8, Math.min(14, Math.round(w / 110)));
      for (let i = 0; i < n; i++) {
        orbs.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 40 + Math.random() * 90,
          vx: (Math.random() - 0.5) * 0.16,
          vy: (Math.random() - 0.5) * 0.12,
          hue: Math.random() < 0.45 ? 0 : 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (time: number) => {
      const [amber, primary] = colors();
      ctx.clearRect(0, 0, w, h);

      for (const o of orbs) {
        if (!reduced) {
          o.x += o.vx;
          o.y += o.vy;
          if (o.x < -o.r) o.x = w + o.r;
          if (o.x > w + o.r) o.x = -o.r;
          if (o.y < -o.r) o.y = h + o.r;
          if (o.y > h + o.r) o.y = -o.r;
        }
        const pulse = reduced ? 1 : 1 + Math.sin(time / 1600 + o.phase) * 0.12;
        const r = o.r * pulse;
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r);
        const c = o.hue === 0 ? amber : primary;
        g.addColorStop(0, c + "2e");
        g.addColorStop(1, c + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        if (!rp) continue;
        const t = (time - rp.t) / 1100;
        if (t >= 1) {
          ripples.splice(i, 1);
          continue;
        }
        const r = 24 + t * 260;
        ctx.strokeStyle = amber + Math.round((1 - t) * 120).toString(16).padStart(2, "0");
        ctx.lineWidth = 2.5 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (!s) continue;
        const t = (time - s.t) / 700;
        if (t >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.05;
        const c = s.hue === 0 ? amber : primary;
        ctx.fillStyle = c + Math.round((1 - t) * 200).toString(16).padStart(2, "0");
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.4 * (1 - t) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (time: number) => {
      draw(time);
      if (running) raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || !visible) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    if (reduced) {
      draw(0);
    } else {
      start();
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible && !reduced) start();
      else stop();
    });
    io.observe(canvas);

    const onPointer = (e: PointerEvent) => {
      if (reduced) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ripples.push({ x, y, t: performance.now() });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 1 + Math.random() * 2.4;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, t: performance.now(), hue: Math.random() < 0.6 ? 0 : 1 });
      }
    };
    const host = canvas.parentElement;
    host?.addEventListener("pointerdown", onPointer);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      host?.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
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
