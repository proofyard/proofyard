const GalleryLayout = ({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) => (
  <>
    {children}
    {modal}
  </>
);
export default GalleryLayout;
