import { db } from "./db";
import { joinTeam } from "./actions";
import { JoinButton, UserForm } from "./user-form";

export function UsersPage() {
  return (
    <main>
      <ul aria-label="users">
        {db.users.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
      <UserForm />
      <JoinButton join={joinTeam.bind(null, "core")} />
    </main>
  );
}
