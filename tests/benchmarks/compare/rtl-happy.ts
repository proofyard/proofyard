// React Testing Library + happy-dom（Client Component だけを描画する、いまの一般的なやり方）
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
