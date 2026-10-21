export default async function Boom(): Promise<never> {
  throw new Error("boom");
}
