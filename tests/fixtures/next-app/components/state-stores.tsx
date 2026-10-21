"use client";
// サードパーティの状態管理ライブラリ（モジュールのスコープにストアを持つ）
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { atom, useAtom } from "jotai";
import { Provider, useDispatch, useSelector } from "react-redux";
import { create } from "zustand";

const useBears = create<{ bears: number; add: () => void }>((set) => ({ bears: 0, add: () => set((s) => ({ bears: s.bears + 1 })) }));
const countAtom = atom(0);
const counter = createSlice({ name: "counter", initialState: { value: 0 }, reducers: { increment: (s) => void (s.value += 1) } });
const store = configureStore({ reducer: { counter: counter.reducer } });

export function ReduxProvider({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

export function Stores() {
  const { bears, add } = useBears();
  const [count, setCount] = useAtom(countAtom);
  const value = useSelector((s: ReturnType<typeof store.getState>) => s.counter.value);
  const dispatch = useDispatch();
  return (
    <div>
      <button type="button" onClick={add}>zustand: {bears}</button>
      <button type="button" onClick={() => setCount((c) => c + 1)}>jotai: {count}</button>
      <button type="button" onClick={() => dispatch(counter.actions.increment())}>redux: {value}</button>
    </div>
  );
}
