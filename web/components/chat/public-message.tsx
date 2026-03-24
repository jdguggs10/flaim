"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface PublicMessageProps {
  role: "user" | "assistant";
  text: string;
}

export function PublicMessage({ role, text }: PublicMessageProps) {
  const isUser = role === "user";

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-3xl overflow-hidden rounded-[1.1rem] border px-3 py-3 shadow-sm sm:rounded-[1.35rem] sm:px-4 sm:py-4 lg:rounded-[2rem] lg:px-5",
          isUser
            ? "border-border bg-muted text-foreground"
            : "border-border bg-card text-foreground"
        )}
      >
        <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] sm:mb-3 sm:text-[11px]">
          {isUser ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-foreground" />
              You picked
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              What Flaim found
            </>
          )}
        </div>
        <div
          className={cn(
            "prose prose-sm max-w-none prose-p:my-0 prose-ul:my-2 prose-li:my-0 prose-li:marker:text-muted-foreground",
            isUser
              ? "prose-headings:text-foreground prose-strong:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground"
              : "prose-headings:text-foreground prose-strong:text-foreground prose-p:text-foreground prose-li:text-foreground"
          )}
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
