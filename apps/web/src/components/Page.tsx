import Link from "next/link";
import type { ReactNode } from "react";
import { FilterBar } from "./FilterBar";
import { PageHead } from "./ui";

/** Standard page frame: title, (filter bar), content area. */
export function Page({ title, lede, actions, filters = true, children }: {
  title: string; lede?: string; actions?: ReactNode; filters?: boolean; children: ReactNode;
}) {
  return (
    <>
      <PageHead title={title} lede={lede} actions={actions} />
      {filters && <FilterBar />}
      <div className="content">{children}</div>
    </>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} className={`tab ${active === t.key ? "active" : ""}`} role="tab" href={t.href}>{t.label}</Link>
      ))}
    </div>
  );
}
