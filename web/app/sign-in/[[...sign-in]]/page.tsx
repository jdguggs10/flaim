import { SignIn } from '@clerk/nextjs';

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-[50vh] py-12">
      <SignIn />
    </div>
  );
}
