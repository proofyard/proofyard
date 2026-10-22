import { load } from "fake-cached";

// node_modules のパッケージの "use cache"（Next.js と同じくアプリのソースと同じ SWC で変換する）
export default async function Page() {
  return (
    <main>
      <h1>Library</h1>
      <p>{await load()}</p>
    </main>
  );
}
