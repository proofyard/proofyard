import { addEntry, listEntries } from "fake-actions";
import { connection } from "next/server";
import { EntryCount } from "../../../components/entry-count";

export default async function Page() {
  await connection();
  const entries = await listEntries();
  return (
    <main>
      <ul aria-label="entries">
        {entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      <form action={addEntry}>
        <input name="entry" aria-label="entry" />
        <button>Add entry</button>
      </form>
      <EntryCount />
    </main>
  );
}
