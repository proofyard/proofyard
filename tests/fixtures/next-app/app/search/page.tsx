// next/form: action が文字列なら、送信はクライアントのナビゲーション（GET でクエリに）
import Form from "next/form";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <main>
      <Form action="/search">
        <input name="q" aria-label="Query" defaultValue={q} />
        <button type="submit">Search</button>
      </Form>
      <p>{q ? `Results for ${q}` : "No query"}</p>
    </main>
  );
}
