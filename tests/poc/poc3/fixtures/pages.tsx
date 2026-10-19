import { Suspense } from "react";
import { Counter, Greeting, Modal, Phase, UserName } from "./widgets";

export function InteractivePage() {
  return (
    <main>
      <Counter label="Clicks" />
      <Greeting />
      <Modal>Portal content</Modal>
    </main>
  );
}

export function StreamingPage({ user }: { user: Promise<string> }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <UserName user={user} />
    </Suspense>
  );
}

export function HydrationPage() {
  return (
    <div>
      <Counter label="Hydrated" />
      <Phase />
    </div>
  );
}
