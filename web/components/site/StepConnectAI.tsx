import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CHATGPT_APP_URL } from "@/lib/product-links";
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
            <h3 className="font-semibold text-lg">Connect ChatGPT</h3>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Flaim Fantasy is available in ChatGPT. Connect your leagues first,
            then use ChatGPT for read-only fantasy analysis.
          </p>
        </>
      ) : null}

      <Button asChild size="sm" className="w-full">
        <a href={CHATGPT_APP_URL} target="_blank" rel="noopener noreferrer">
          Open in ChatGPT App Store
          <ExternalLink className="ml-2 h-4 w-4" />
        </a>
      </Button>
    </div>
  );

  return renderCard ? <Card className="p-5">{content}</Card> : content;
}
