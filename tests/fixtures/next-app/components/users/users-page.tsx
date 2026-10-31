import { joinTeam } from "./actions";
import { db } from "./db";
import { JoinButton, UserForm } from "./user-form";

export const UsersPage = () => (
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
