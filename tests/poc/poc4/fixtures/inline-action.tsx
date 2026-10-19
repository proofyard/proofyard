export default function Page() {
  async function submit() {
    "use server";
  }
  return <form action={submit} />;
}
