// Client Graph の Client Mode 用の入口。DOM を用意してから `import(".../dom-runtime.ts?client")` で読む
export { render, cleanup, screen, act, waitFor } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
export { hydrateRoot } from "react-dom/client";
