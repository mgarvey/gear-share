import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { communityLogoUrl, communityName } from "@/config/community";
import { configuredPrivacyContactUrl } from "@/config/publicOrigin";

export const PUBLIC_INFORMATION_EFFECTIVE_DATE = "August 17, 2026";

export function PublicInformationLayout({
  eyebrow,
  title,
  introduction,
  children,
}: {
  eyebrow: string;
  title: string;
  introduction: string;
  children: ReactNode;
}) {
  const contactUrl = configuredPrivacyContactUrl();

  return (
    <main className="min-h-screen bg-sand/40 px-5 py-8">
      <article className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-white shadow-sm">
        <header className="border-b bg-primary px-6 py-7 text-white md:px-10">
          <Link to="/about" className="flex w-fit items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <img src={communityLogoUrl} alt="" className="h-16 w-14 shrink-0 object-contain" />
            <span><strong className="block text-lg">{communityName}</strong><span className="text-sm text-white/85">Gear Share</span></span>
          </Link>
          <p className="mt-6 text-sm font-medium uppercase tracking-wide text-white/80">{eyebrow}</p>
          <h1 className="mt-2 font-serif text-4xl font-bold leading-tight">{title}</h1>
          <p className="mt-3 max-w-2xl text-white/90">{introduction}</p>
        </header>

        <div className="px-6 py-7 md:px-10 md:py-9">{children}</div>

        <footer className="border-t bg-sand/30 px-6 py-5 text-sm md:px-10">
          <nav aria-label="Public information" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="text-terracotta underline" to="/about">About</Link>
            <Link className="text-terracotta underline" to="/privacy">Privacy</Link>
            <Link className="text-terracotta underline" to="/terms">Terms</Link>
            <a className="text-terracotta underline" href={contactUrl}>Contact an Administrator</a>
          </nav>
        </footer>
      </article>
    </main>
  );
}
