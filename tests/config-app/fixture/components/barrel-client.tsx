"use client";

import { fromWildcard } from "fake-barrel";

import { BarrelForm } from "./barrel-form";

// Client Component からのバレルの import（rsc 層では Client Reference になり import が消える）
export const BarrelClient = () => (
  <section>
    <h2>Client: {fromWildcard}</h2>
    <BarrelForm />
  </section>
);
