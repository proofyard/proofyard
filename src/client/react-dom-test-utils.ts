// Next.js 同梱の react-dom には test-utils がない。React 19 の react-dom/test-utils は React.act を再エクスポートするだけなので同じにする
// （@testing-library/react が import する）
export { act } from "react";
