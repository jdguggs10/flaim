"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FIRST_ROW_START = 0.12;
const ROW_STEP = 0.125;
const OLD_LINE_DURATION = 0.09;

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value));
}

function rangeProgress(progress: number, start: number, duration: number) {
  return clampProgress((progress - start) / duration);
}

export function FootballStrikeReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-football-strike-row]"),
    );
    let animationFrame = 0;

    const updateProgress = () => {
      animationFrame = 0;

      const bounds = container.getBoundingClientRect();
      const coverDistance = window.innerHeight + bounds.height;
      const sectionProgress = clampProgress(
        (window.innerHeight - bounds.top) / coverDistance,
      );

      rows.forEach((row, index) => {
        const rowStart = FIRST_ROW_START + index * ROW_STEP;
        const oldProgress = rangeProgress(
          sectionProgress,
          rowStart,
          OLD_LINE_DURATION,
        );
        row.style.setProperty("--strike-old-progress", String(oldProgress));
        row.style.setProperty(
          "--strike-old-copy-opacity",
          String(1 - oldProgress * 0.62),
        );
        row.style.setProperty(
          "--strike-old-blur",
          `${oldProgress * 0.7}px`,
        );
      });
    };

    const requestProgressUpdate = () => {
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    container.classList.add(
      "football-strike-ready",
      "football-strike-scroll-controlled",
    );
    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressUpdate);

    return () => {
      window.removeEventListener("scroll", requestProgressUpdate);
      window.removeEventListener("resize", requestProgressUpdate);

      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`football-strike-sequence ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}
