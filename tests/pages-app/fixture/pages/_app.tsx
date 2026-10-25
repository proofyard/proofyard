import type { AppProps } from "next/app";
import { ThemeContext } from "../lib/theme";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeContext.Provider value="dark">
      <div data-app="">
        <Component {...pageProps} />
      </div>
    </ThemeContext.Provider>
  );
}
