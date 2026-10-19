import { ThemeProvider } from "./theme";
import ServerContent from "./server-content";

// SC(Page) -> CC(ThemeProvider) -> SC(ServerContent) -> CC(Card)
export default function Page() {
  return (
    <main>
      <ThemeProvider>
        <ServerContent />
      </ThemeProvider>
    </main>
  );
}
