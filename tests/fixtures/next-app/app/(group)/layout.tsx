// ルートグループのレイアウト（URL にはグループの名前が入らない）
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return <section data-group="marketing">{children}</section>;
}
