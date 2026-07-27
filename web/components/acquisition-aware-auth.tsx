"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { useEffect, useState } from "react";
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

/**
 * Clerk may create a new user from a transferable OAuth sign-in attempt.
 * Attach the same first-touch metadata used by the explicit sign-up surface.
 */
export function AcquisitionAwareSignIn(props: SignInProps) {
  const metadata = useAcquisitionMetadata();
  if (!metadata) return null;
  return <SignIn {...props} unsafeMetadata={metadata} />;
}

export function AcquisitionAwareSignUp(props: SignUpProps) {
  const metadata = useAcquisitionMetadata();
  if (!metadata) return null;
  return <SignUp {...props} unsafeMetadata={metadata} />;
}
