import { getLocale, LocalePath, requireLocale } from "fake-next-lib";

export default async function Page() {
  const locale = await getLocale();
  requireLocale(locale);
  return (
    <main>
      <p>locale {locale}</p>
      <LocalePath />
    </main>
  );
}
