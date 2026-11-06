// template.tsx is re-created on every navigation => plays the smooth page-enter animation
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
