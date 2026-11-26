import Image from "next/image";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

/*
  The Formidable Builders mark is their file, in their colors, one per theme.
  It is the one place this product shows a color that is not a token.
*/
function FormidableBuilders() {
  return (
    <a
      href="https://formidable.builders"
      className="group flex items-center gap-2.5 rounded-sm"
      aria-label="Built by Formidable Builders"
    >
      <span>Built by</span>
      <Image
        src="/brand/formidable-builders-logo-dark.svg"
        alt=""
        width={180}
        height={130}
        className="h-9 w-auto theme-light:hidden"
        unoptimized
      />
      <Image
        src="/brand/formidable-builders-logo-light.svg"
        alt=""
        width={180}
        height={130}
        className="hidden h-9 w-auto theme-light:block"
        unoptimized
      />
      <span className="text-muted group-hover:text-foreground">Formidable Builders</span>
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border-faint">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-4 px-4 py-8 text-[0.8rem] text-subtle sm:px-6 lg:px-12">
        <LogoMark size={16} />
        <span>Play money. Real bragging rights.</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link className="hover:text-foreground" href="/docs">Docs</Link>
          <a className="hover:text-foreground" href="https://github.com/formidable-oss/tokenburnmarket">GitHub</a>
          <span>MIT</span>
          <FormidableBuilders />
        </span>
      </div>
    </footer>
  );
}
