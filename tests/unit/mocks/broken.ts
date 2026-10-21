// テストでは読み込めないモジュール（server-only や、環境変数の要る接続など）
throw new Error("broken: needs a database");
export const query = () => "rows";
