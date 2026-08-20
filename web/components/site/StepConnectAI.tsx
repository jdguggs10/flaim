import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CHATGPT_APP_URL, CLAUDE_CONNECTOR_DIRECTORY_URL } from "@/lib/product-links";
import { ExternalLink } from "lucide-react";

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
            <h3 className="font-semibold text-lg">Connect your AI app</h3>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Flaim Fantasy is available in ChatGPT and Claude. Connect your
            leagues first, then use your AI app for read-only fantasy
            analysis.
          </p>
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button asChild size="sm" className="w-full">
          <a href={CHATGPT_APP_URL} target="_blank" rel="noopener noreferrer">
            Open in ChatGPT
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" className="w-full">
          <a
            href={CLAUDE_CONNECTOR_DIRECTORY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Claude
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  );

  return renderCard ? <Card className="p-5">{content}</Card> : content;
}
