import { getLocale, LocalePath, requireLocale } from "fake-next-lib";

const Page = async () => {
  const locale = await getLocale();
  requireLocale(locale);
  return (
    <main>
      <p>locale {locale}</p>
      <LocalePath />
    </main>
  );
};
export default Page;
