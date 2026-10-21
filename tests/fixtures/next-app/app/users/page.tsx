import { db } from "../../components/users/db";
import { addAndOpen, addUser } from "./actions";

export default function Users() {
  return (
    <main>
      <h1>Users</h1>
      <ul aria-label="users">
        {db.users.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      <form action={addUser}>
        <input name="name" aria-label="new user" />
        <button>Add</button>
      </form>
      <form action={addAndOpen}>
        <input name="name" aria-label="open user" />
        <button>Add and open</button>
      </form>
    </main>
  );
}
