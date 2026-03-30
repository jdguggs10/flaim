"use client";

import { useEffect, useState, useRef } from "react";

const ROTATING_WORDS = [
  "rosters",
  "standings",
  "matchups",
  "free agents",
  "transactions",
  "player stats",
  "league history",
  "waiver wire",
];

type Variant =
  | "A" | "B" | "C" | "D" | "F" | "G"
  | "K" | "L" | "M" | "N";

const VARIANT_LABELS: Record<Variant, string> = {
  A: "Soft pill",
  B: "Underline",
  C: "Gradient text",
  D: "Outline pill",
  F: "Typewriter",
  G: "Highlighter",
  K: "Color cycle",
  L: "Gradient pill",
  M: "Neon",
  N: "Rainbow sweep",
};

const COLOR_CYCLE = [
  "text-blue-500 dark:text-blue-400",
  "text-emerald-500 dark:text-emerald-400",
  "text-orange-500 dark:text-orange-400",
  "text-violet-500 dark:text-violet-400",
  "text-rose-500 dark:text-rose-400",
  "text-cyan-500 dark:text-cyan-400",
  "text-amber-500 dark:text-amber-400",
  "text-fuchsia-500 dark:text-fuchsia-400",
];

const ALL_VARIANTS = Object.keys(VARIANT_LABELS) as Variant[];

/* ------------------------------------------------------------------ */
/*  Hidden style picker — invisible button in header whitespace       */
/* ------------------------------------------------------------------ */

function HiddenStylePicker({
  variant,
  onSelect,
}: {
  variant: Variant;
  onSelect: (v: Variant) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="fixed top-3 left-1/2 -translate-x-1/2 z-[60]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-yellow-600 transition-colors hover:bg-yellow-500/20 dark:text-yellow-400"
      >
        Preview
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 max-h-[70vh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <div className="mb-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Hero style
          </div>
          {ALL_VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() => {
                onSelect(v);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                variant === v
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                             */
/* ------------------------------------------------------------------ */

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

function useRotatingWord(
  prefersReducedMotion: boolean,
  mode: "slide" | "typewriter",
) {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [displayedChars, setDisplayedChars] = useState(
    ROTATING_WORDS[0].length,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Slide animation
  useEffect(() => {
    if (prefersReducedMotion || mode !== "slide") return;

    const interval = window.setInterval(() => {
      setIsAnimating(true);
      const exitTimer = window.setTimeout(() => {
        setIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setIsAnimating(false);
      }, 300);
      return () => window.clearTimeout(exitTimer);
    }, 2400);

    return () => window.clearInterval(interval);
  }, [prefersReducedMotion, mode]);

  // Typewriter animation
  useEffect(() => {
    if (prefersReducedMotion || mode !== "typewriter") return;

    const word = ROTATING_WORDS[index];

    if (!isDeleting && displayedChars < word.length) {
      const t = window.setTimeout(
        () => setDisplayedChars((c) => c + 1),
        60 + Math.random() * 40,
      );
      return () => window.clearTimeout(t);
    }

    if (!isDeleting && displayedChars === word.length) {
      const t = window.setTimeout(() => setIsDeleting(true), 1800);
      return () => window.clearTimeout(t);
    }

    if (isDeleting && displayedChars > 0) {
      const t = window.setTimeout(
        () => setDisplayedChars((c) => c - 1),
        35,
      );
      return () => window.clearTimeout(t);
    }

    if (isDeleting && displayedChars === 0) {
      setIsDeleting(false);
      setIndex((i) => (i + 1) % ROTATING_WORDS.length);
    }
  }, [prefersReducedMotion, mode, index, displayedChars, isDeleting]);

  useEffect(() => {
    if (mode === "typewriter" && !isDeleting) {
      setDisplayedChars(0);
    }
  }, [index, mode, isDeleting]);

  return {
    currentWord: ROTATING_WORDS[index],
    wordIndex: index,
    isAnimating,
    displayedChars,
  };
}

/* ------------------------------------------------------------------ */
/*  Rotating word renderer                                            */
/* ------------------------------------------------------------------ */

function RotatingWord({
  variant,
  currentWord,
  wordIndex,
  isAnimating,
  displayedChars,
  prefersReducedMotion,
}: {
  variant: Variant;
  currentWord: string;
  wordIndex: number;
  isAnimating: boolean;
  displayedChars: number;
  prefersReducedMotion: boolean;
}) {
  const slideStyle = prefersReducedMotion
    ? undefined
    : {
        transition:
          "transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
        transform: isAnimating ? "translateY(-110%)" : "translateY(0)",
        opacity: isAnimating ? 0 : 1,
      };

  if (variant === "F") {
    const partial = currentWord.slice(0, displayedChars);
    return (
      <>
        <span className="text-primary">{partial}</span>
        <span
          className="ml-0.5 inline-block h-[0.85em] w-[3px] translate-y-[0.1em] rounded-full bg-primary/70"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: "hero-cursor-blink 0.8s step-end infinite" }
          }
        />
      </>
    );
  }

  if (variant === "A") {
    // Soft pill — background stays, text slides
    return (
      <span className="inline-flex items-baseline overflow-hidden rounded-lg bg-primary/10 px-2.5 py-0.5 align-baseline dark:bg-primary/15">
        <span className="inline-block text-primary" style={slideStyle}>
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "B") {
    // Underline — border stays, text slides
    return (
      <span className="inline-flex items-baseline overflow-hidden border-b-[3px] border-primary/50 pb-0.5 align-baseline">
        <span className="inline-block text-foreground" style={slideStyle}>
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "C") {
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block bg-gradient-to-r from-blue-500 via-violet-500 to-purple-500 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-purple-400"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "D") {
    // Outline pill — border stays, text slides
    return (
      <span className="inline-flex items-baseline overflow-hidden rounded-lg border-2 border-primary/30 px-2.5 py-0.5 align-baseline">
        <span className="inline-block text-primary" style={slideStyle}>
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "G") {
    // Highlighter — yellow stroke stays, text slides
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="absolute inset-x-[-4px] bottom-[0.05em] top-[0.35em] -skew-x-2 rounded-sm bg-yellow-300/50 dark:bg-yellow-400/30"
          aria-hidden
        />
        <span className="relative inline-block text-foreground" style={slideStyle}>
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "K") {
    // Color cycle — each word gets a different color
    const colorClass = COLOR_CYCLE[wordIndex % COLOR_CYCLE.length];
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className={`inline-block transition-colors duration-500 ${colorClass}`}
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "L") {
    // Gradient pill — gradient background, white text
    return (
      <span className="inline-flex items-baseline overflow-hidden rounded-lg bg-gradient-to-r from-blue-500 via-violet-500 to-purple-500 px-3 py-0.5 align-baseline dark:from-blue-600 dark:via-violet-600 dark:to-purple-600">
        <span
          className="inline-block text-white"
          style={slideStyle}
        >
          {currentWord}
        </span>
      </span>
    );
  }

  if (variant === "M") {
    // Neon — bright color with intense glow
    return (
      <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
        <span
          className="inline-block text-emerald-400"
          style={
            prefersReducedMotion
              ? undefined
              : {
                  textShadow:
                    "0 0 7px rgb(52 211 153 / 0.7), 0 0 20px rgb(52 211 153 / 0.4), 0 0 40px rgb(52 211 153 / 0.2)",
                  ...slideStyle,
                }
          }
        >
          {currentWord}
        </span>
      </span>
    );
  }

  // N: Rainbow sweep — gradient animates across text
  return (
    <span className="relative inline-flex items-baseline overflow-hidden align-baseline">
      <span
        className="inline-block bg-clip-text text-transparent"
        style={
          prefersReducedMotion
            ? { color: "var(--primary)" }
            : {
                backgroundImage:
                  "linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899, #f97316, #3b82f6)",
                backgroundSize: "200% 100%",
                animation: "hero-rainbow-sweep 3s linear infinite",
                ...slideStyle,
              }
        }
      >
        {currentWord}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function HeroChat() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [variant, setVariant] = useState<Variant>("A");

  const mode = variant === "F" ? ("typewriter" as const) : ("slide" as const);

  const { currentWord, wordIndex, isAnimating, displayedChars } =
    useRotatingWord(prefersReducedMotion, mode);

  return (
    <>
      <HiddenStylePicker variant={variant} onSelect={setVariant} />

      <section className="px-4 py-10 md:py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="mb-6 text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
            <span className="block text-foreground/55">
              Can you see my fantasy leagues?
            </span>
            <span className="mt-4 block text-foreground md:mt-5">
              Yes, your{" "}
              <RotatingWord
                variant={variant}
                currentWord={currentWord}
                wordIndex={wordIndex}
                isAnimating={isAnimating}
                displayedChars={displayedChars}
                prefersReducedMotion={prefersReducedMotion}
              />
              {variant !== "F" && "."}
            </span>
          </h1>
          <p className="max-w-xl text-lg leading-7 text-foreground/70 md:text-xl md:leading-8">
            Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
            Sleeper. Ask about start/sit decisions, waiver wire targets, and
            what matters in your league right now.
          </p>
        </div>
      </section>
    </>
  );
}
