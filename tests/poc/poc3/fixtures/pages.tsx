import { Suspense } from "react";

import { Counter, Greeting, Modal, Phase, UserName } from "./widgets";

export const InteractivePage = () => (
  <main>
    <Counter label="Clicks" />
    <Greeting />
    <Modal>Portal content</Modal>
  </main>
);

export const StreamingPage = ({ user }: { user: Promise<string> }) => (
  <Suspense fallback={<p>Loading...</p>}>
    <UserName user={user} />
  </Suspense>
);

export const HydrationPage = () => (
  <div>
    <Counter label="Hydrated" />
    <Phase />
  </div>
);
