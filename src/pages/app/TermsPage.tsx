import { Link } from "react-router-dom";
import { communityName } from "@/config/community";
import { PUBLIC_INFORMATION_EFFECTIVE_DATE, PublicInformationLayout } from "./PublicInformationLayout";

export default function TermsPage() {
  return (
    <PublicInformationLayout
      eyebrow={`Version 1 · Effective ${PUBLIC_INFORMATION_EFFECTIVE_DATE}`}
      title="Terms of use"
      introduction="Practical expectations for using this private, volunteer-run community gear share."
    >
      <nav aria-label="Terms sections" className="mb-7 flex flex-wrap gap-3 text-sm">
        <a className="underline" href="#access">Access</a>
        <a className="underline" href="#conduct">Community use</a>
        <a className="underline" href="#gear">Shared gear</a>
        <a className="underline" href="#service">Service access</a>
      </nav>

      <div className="space-y-8 leading-relaxed">
        <section id="access"><h2 className="font-serif text-2xl font-bold">Accounts and access</h2><p className="mt-2">Gear Share is for people requesting participation in the {communityName} community. Provide accurate account and application information, use only your own account, and keep your sign-in method secure. An account or Google sign-in does not grant membership; an Administrator must approve access.</p></section>
        <section id="conduct"><h2 className="font-serif text-2xl font-bold">Community use</h2><p className="mt-2">Use Gear Share for genuine community sharing. Do not copy private catalog information, photos, member details, or loan information outside the service; impersonate another person; interfere with the service; or use it for public listings, unsolicited messages, marketing, payments, or prohibited activity.</p></section>
        <section id="gear"><h2 className="font-serif text-2xl font-bold">Borrowing and sharing gear</h2><p className="mt-2">Describe listed gear honestly, follow the recorded loan process, coordinate only through the contact details made available for an approved loan, and return items in the agreed condition and timeframe. Inspect gear before use, follow its instructions, and promptly report damage, loss, or a safety concern. Do not use an item you believe may be unsafe or unsuitable.</p></section>
        <section id="privacy"><h2 className="font-serif text-2xl font-bold">Privacy</h2><p className="mt-2">The <Link className="text-terracotta underline" to="/privacy">Privacy notice</Link> explains what information the service keeps, who can see it, which service providers may process it, and how to request help or correction.</p></section>
        <section id="service"><h2 className="font-serif text-2xl font-bold">Availability and access administration</h2><p className="mt-2">This is a small volunteer-run service, so features or particular gear may be unavailable. Administrators may review, reject, deactivate, or restore membership through the documented community process. Operational changes to these terms will be dated and published here before they are used as the current version.</p></section>
        <aside className="rounded-lg border-2 border-terracotta/60 bg-sand/60 p-4"><h2 className="font-serif text-2xl font-bold">What these terms do not add</h2><p className="mt-2">This page does not create automatic membership, a payment obligation, a legal waiver, or a checkbox-based acceptance requirement.</p></aside>
      </div>
    </PublicInformationLayout>
  );
}
