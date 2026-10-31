// テストでは読み込めないモジュール（server-only や、環境変数の要る接続など）
throw new Error("broken: needs a database");
// oxlint-disable-next-line eslint/no-unreachable -- 読み込むと失敗するモジュール（mock.module で差し替える）
export const query = () => "rows";
