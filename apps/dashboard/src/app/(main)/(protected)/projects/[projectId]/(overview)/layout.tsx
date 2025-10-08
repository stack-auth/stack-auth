export default function Page({ children, modal }: { children: React.ReactNode, modal?: React.ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
