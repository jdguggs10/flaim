import Link from "next/link";

import { Button } from "@/components/ui/button";

interface GuideStepNavigationProps {
  backHref: string;
  backLabel: string;
  nextHref: string;
  nextLabel: string;
}

export function GuideStepNavigation({
  backHref,
  backLabel,
  nextHref,
  nextLabel,
}: GuideStepNavigationProps) {
  return (
    <nav
      aria-label="Setup step navigation"
      className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href={nextHref}>{nextLabel}</Link>
      </Button>
    </nav>
  );
}
