import { Suspense } from "react";
import { getUsers } from "./users";
import { LikeButton } from "./like-button";

async function Users() {
  const users = await getUsers();
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>
          <span>{user.name}</span>
          <LikeButton userId={user.id} initial={0} />
        </li>
      ))}
    </ul>
  );
}

export function UserList() {
  return (
    <section>
      <h1>Users</h1>
      <Suspense fallback={<p>Loading users...</p>}>
        <Users />
      </Suspense>
    </section>
  );
}
