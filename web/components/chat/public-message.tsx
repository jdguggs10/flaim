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
          "max-w-3xl overflow-hidden rounded-[2rem] border px-5 py-4 shadow-sm",
          isUser
            ? "border-border bg-muted text-foreground"
            : "border-border bg-primary text-primary-foreground"
        )}
      >
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em]">
          {isUser ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-foreground" />
              Prompt selected
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Live answer
            </>
          )}
        </div>
        <div
          className={cn(
            "prose prose-sm max-w-none prose-p:my-0 prose-ul:my-2 prose-li:my-0",
            isUser
              ? "prose-headings:text-foreground prose-strong:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground"
              : "prose-invert prose-headings:text-primary-foreground prose-strong:text-primary-foreground prose-p:text-primary-foreground prose-li:text-primary-foreground"
          )}
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
