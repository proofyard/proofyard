"use client";
// サードパーティの状態管理ライブラリ（モジュールのスコープにストアを持つ）
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { atom, useAtom } from "jotai";
import { Provider, useDispatch, useSelector } from "react-redux";
import { create } from "zustand";

const useBears = create<{ bears: number; add: () => void }>((set) => ({
  add: () => set((s) => ({ bears: s.bears + 1 })),
  bears: 0,
}));
const countAtom = atom(0);
const counter = createSlice({
  initialState: { value: 0 },
  name: "counter",
  reducers: {
    increment: (s) => {
      s.value += 1;
    },
  },
});
const store = configureStore({ reducer: { counter: counter.reducer } });

export const ReduxProvider = ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);

export const Stores = () => {
  const { bears, add } = useBears();
  const [count, setCount] = useAtom(countAtom);
  const value = useSelector(
    (s: ReturnType<typeof store.getState>) => s.counter.value
  );
  const dispatch = useDispatch();
  return (
    <div>
      <button type="button" onClick={add}>
        zustand: {bears}
      </button>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        jotai: {count}
      </button>
      <button
        type="button"
        onClick={() => dispatch(counter.actions.increment())}
      >
        redux: {value}
      </button>
    </div>
  );
};
