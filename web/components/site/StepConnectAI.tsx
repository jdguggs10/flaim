"use client";

import { Card } from "@/components/ui/card";
import Link from "next/link";

interface StepConnectAIProps {
  showStepNumber?: boolean;
  renderCard?: boolean;
  showHeader?: boolean;
}

export function StepConnectAI({
  showStepNumber = true,
  renderCard = true,
  showHeader = true,
}: StepConnectAIProps) {
  const content = (
    <div className="flex flex-col">
      {showHeader ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            {showStepNumber ? (
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                3
              </div>
            ) : null}
            <h3 className="font-semibold text-lg">Connect ChatGPT</h3>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Flaim Fantasy is available in ChatGPT. Connect your leagues first,
            then use ChatGPT for read-only fantasy analysis.
          </p>
        </>
      ) : null}

      <p className="mb-3 text-xs text-muted-foreground">
        After ESPN, Yahoo, or Sleeper is connected, open ChatGPT and use Flaim
        Fantasy.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <Link
            href="/guide/ai#chatgpt"
            className="text-xs font-medium text-primary hover:underline"
          >
            ChatGPT setup
          </Link>
          <span className="text-[10px] text-success">Primary</span>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <Link
            href="/leagues"
            className="text-xs font-medium text-primary hover:underline"
          >
            Connected leagues
          </Link>
          <span className="text-[10px] text-muted-foreground">Required</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Start a fresh ChatGPT conversation and ask “What leagues do I have?” to
        confirm Flaim can see your connected fantasy context.
      </p>
    </div>
  );

  return renderCard ? <Card className="p-5">{content}</Card> : content;
}
