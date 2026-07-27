import type { Metadata } from 'next';
import { AcquisitionAwareSignUp } from '@/components/acquisition-aware-auth';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] py-12">
      <AcquisitionAwareSignUp fallbackRedirectUrl="/leagues" />
    </div>
  );
}
