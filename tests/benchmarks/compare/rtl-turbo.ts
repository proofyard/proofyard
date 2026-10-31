// React Testing Library + turbo-dom（Client Component だけを描画する）
import { installGlobals } from "@miaskiewicz/turbo-dom/install";

installGlobals(globalThis, {
  html: "<!doctype html><html><head></head><body></body></html>",
});
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
