// ルートグループのレイアウト（URL にはグループの名前が入らない）
const GroupLayout = ({ children }: { children: React.ReactNode }) => (
  <section data-group="marketing">{children}</section>
);
export default GroupLayout;
