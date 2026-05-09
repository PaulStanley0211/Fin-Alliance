import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/auth/AuthGate";

export default function Home() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
