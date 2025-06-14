// ESPN Authentication Types
export interface EspnCredentials {
  clerkUserId: string;  // Clerk user ID as primary key
  swid: string;
  espn_s2: string;
  email?: string;
  created_at: string;
  updated_at: string;
}