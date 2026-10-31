import { Suspense } from "react";

import { LikeButton } from "./like-button";
import { getUsers } from "./users";

const Users = async () => {
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
};

export const UserList = () => (
  <section>
    <h1>Users</h1>
    <Suspense fallback={<p>Loading users...</p>}>
      <Users />
    </Suspense>
  </section>
);
