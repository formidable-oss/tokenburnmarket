import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border-faint">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-[0.8rem] text-subtle sm:px-6 lg:px-12">
        <LogoMark size={16} />
        <span>Play money. Real bragging rights.</span>
        <span className="ml-auto flex gap-5">
          <Link className="hover:text-foreground" href="/docs">Docs</Link>
          <a className="hover:text-foreground" href="https://github.com/formidable-oss/tokenburnmarket">GitHub</a>
          <a className="hover:text-foreground" href="https://formidable.builders">Formidable Builders</a>
          <span>MIT</span>
        </span>
      </div>
    </footer>
  );
}
