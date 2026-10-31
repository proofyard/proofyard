import ServerContent from "./server-content";
import { ThemeProvider } from "./theme";

// SC(Page) -> CC(ThemeProvider) -> SC(ServerContent) -> CC(Card)
const Page = () => (
  <main>
    <ThemeProvider>
      <ServerContent />
    </ThemeProvider>
  </main>
);

export default Page;
