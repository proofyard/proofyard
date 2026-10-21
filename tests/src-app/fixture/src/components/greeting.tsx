"use client";
import { useState } from "react";
import { greet } from "@/lib/greet";

export function Greeting() {
  const [name, setName] = useState("nobody");
  return (
    <button type="button" onClick={() => setName("Alice")}>
      {greet(name)}
    </button>
  );
}
