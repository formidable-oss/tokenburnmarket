import { DocsNav } from "./nav";

/*
  Every docs page is the same shape: a rail of links on the left, one column of
  prose on the right. Nothing here reads the database, so the section is static.
*/
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="mx-auto grid min-w-0 max-w-[1200px] gap-10 px-4 pb-24 pt-12 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16 lg:px-12 lg:pt-16">
      <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <p className="type-label mb-4">docs</p>
        <DocsNav />
        <div className="signal-rail my-6" aria-hidden />
        <p className="text-[0.82rem] text-subtle">
          Something wrong here?{" "}
          <a
            className="hover:text-foreground"
            href="https://github.com/formidable-oss/tokenburnmarket/issues"
          >
            Open an issue
          </a>
          .
        </p>
      </aside>
      <div className="min-w-0 max-w-[68ch]">{children}</div>
    </div>
  );
}
