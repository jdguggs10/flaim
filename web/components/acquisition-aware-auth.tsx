"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import React, { useEffect, useState } from "react";
import {
  acquisitionUnsafeMetadata,
  getOrCaptureBrowserFirstTouch,
} from "@/lib/acquisition";

type SignInProps = React.ComponentProps<typeof SignIn>;
type SignUpProps = React.ComponentProps<typeof SignUp>;

function useAcquisitionMetadata() {
  const [metadata, setMetadata] = useState<Record<
    string,
    unknown
  > | null>(null);

  useEffect(() => {
    setMetadata(
      acquisitionUnsafeMetadata(getOrCaptureBrowserFirstTouch()) ?? {}
    );
  }, []);

  return metadata;
}

function AuthLoading({ label }: { label: string }) {
  return (
    <div
      aria-label={label}
      className="h-[480px] w-full max-w-sm animate-pulse rounded-xl border bg-muted/40"
    />
  );
}

/**
 * Clerk may create a new user from a transferable OAuth sign-in attempt.
 * Attach the same first-touch metadata used by the explicit sign-up surface.
 */
export function AcquisitionAwareSignIn(props: SignInProps) {
  const metadata = useAcquisitionMetadata();
  if (!metadata) return <AuthLoading label="Loading sign-in" />;
  return <SignIn {...props} unsafeMetadata={metadata} />;
}

export function AcquisitionAwareSignUp(props: SignUpProps) {
  const metadata = useAcquisitionMetadata();
  if (!metadata) return <AuthLoading label="Loading sign-up" />;
  return <SignUp {...props} unsafeMetadata={metadata} />;
}
