"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

const SHOWCASE_ITEMS = [
  {
    id: "connected-leagues",
    label: "Connected leagues",
    title: "Your football leagues, ready in one place",
    description:
      "Flaim brings ESPN, Yahoo, and Sleeper leagues into the same AI conversation.",
    image: "/media/football/connected-leagues-widget-2026.png",
    alt: "Flaim connected-leagues widget showing football leagues from ESPN and Sleeper alongside other fantasy leagues.",
    imageClassName: "object-contain p-5 sm:p-8",
  },
  {
    id: "claude-standings",
    label: "Real football answer",
    title: "Claude checking a connected league",
    description:
      "Flaim retrieving fantasy football standings from a connected league without a roster screenshot or manual entry.",
    image: "/media/football/claude-football-standings-2026.png",
    alt: "Claude using Flaim to retrieve standings from a connected fantasy football league.",
    imageClassName: "object-contain",
  },
] as const;

const ROTATION_INTERVAL_MS = 6500;

export function FootballMediaShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (isPaused || prefersReducedMotion) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % SHOWCASE_ITEMS.length);
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [isPaused]);

  const showPrevious = () => {
    setActiveIndex(
      (current) =>
        (current - 1 + SHOWCASE_ITEMS.length) % SHOWCASE_ITEMS.length,
    );
  };

  const showNext = () => {
    setActiveIndex((current) => (current + 1) % SHOWCASE_ITEMS.length);
  };

  const activeItem = SHOWCASE_ITEMS[activeIndex];

  return (
    <div
      className="rounded-[2rem] border bg-[#0b0f15] p-3 text-white shadow-xl shadow-black/10 sm:p-4"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsPaused(false);
        }
      }}
      role="region"
      aria-label="Flaim Fantasy in action"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-[1.35rem] bg-[#10141b]">
        {SHOWCASE_ITEMS.map((item, index) => (
          <Image
            key={item.id}
            src={item.image}
            alt={item.alt}
            aria-hidden={activeIndex !== index}
            fill
            priority={index === 0}
            sizes="(min-width: 1024px) 52vw, (min-width: 640px) 80vw, 92vw"
            className={`${item.imageClassName} transition-opacity duration-500 motion-reduce:transition-none ${
              activeIndex === index ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-4 px-2 pb-2 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-h-[5.5rem] max-w-xl" aria-live="polite">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            {activeItem.label}
          </p>
          <p className="mt-2 font-semibold">{activeItem.title}</p>
          <p className="mt-1 text-sm leading-6 text-white/65">
            {activeItem.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          <div
            className="flex items-center gap-1.5"
            role="group"
            aria-label="Choose a showcase image"
          >
            {SHOWCASE_ITEMS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show ${item.label.toLowerCase()}`}
                aria-pressed={activeIndex === index}
                className={`h-2.5 rounded-full transition-[width,background-color] motion-reduce:transition-none ${
                  activeIndex === index
                    ? "w-7 bg-white"
                    : "w-2.5 bg-white/30 hover:bg-white/55"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={showPrevious}
              aria-label="Show previous image"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={showNext}
              aria-label="Show next image"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
