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
    <div className={cn("flex", isUser ? "justify-start" : "justify-start")}>
      <div
        className={cn(
          "max-w-3xl overflow-hidden rounded-[2rem] border px-5 py-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur",
          isUser
            ? "border-white/70 bg-white/80 text-slate-900"
            : "border-slate-900/10 bg-slate-950 text-white"
        )}
      >
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em]">
          {isUser ? (
            <>
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Prompt selected
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              Live answer
            </>
          )}
        </div>
        <div
          className={cn(
            "prose prose-sm max-w-none prose-p:my-0 prose-ul:my-2 prose-li:my-0",
            isUser
              ? "prose-headings:text-slate-900 prose-strong:text-slate-900 prose-p:text-slate-700 prose-li:text-slate-700"
              : "prose-invert prose-headings:text-white prose-strong:text-white prose-p:text-slate-200 prose-li:text-slate-200"
          )}
        >
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
