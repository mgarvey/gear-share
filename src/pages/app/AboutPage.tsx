import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { communityName, gearShareName } from "@/config/community";
import { PublicInformationLayout } from "./PublicInformationLayout";

export default function AboutPage() {
  return (
    <PublicInformationLayout
      eyebrow="Private community gear sharing"
      title={gearShareName}
      introduction={`A private place for approved members of the ${communityName} community to share useful outdoor gear and help more families get outside.`}
    >
      <div className="space-y-8 leading-relaxed">
        <section aria-labelledby="about-purpose">
          <h2 id="about-purpose" className="font-serif text-2xl font-bold">What Gear Share does</h2>
          <p className="mt-2">Approved members can list personally owned or group-owned gear, request an item for specific dates, coordinate pickup after approval, track returns, and post wanted-gear requests. The catalog, gear photos, member details, and loan activity are not public.</p>
        </section>

        <section aria-labelledby="about-access" className="rounded-lg border bg-sand/40 p-5">
          <h2 id="about-access" className="font-serif text-2xl font-bold">Membership is reviewed</h2>
          <p className="mt-2">Anyone may request membership, but creating an account does not open the catalog. Every applicant remains pending until a {communityName} Administrator reviews and approves the request.</p>
        </section>

        <section aria-labelledby="about-google">
          <h2 id="about-google" className="font-serif text-2xl font-bold">Google sign-in</h2>
          <p className="mt-2">When Google sign-in is offered, it is used only to establish or link your Gear Share account using basic identity information such as your confirmed email and name. It does not approve membership and does not give Gear Share access to your Google Drive, contacts, calendar, photos, or messages.</p>
        </section>

        <section aria-labelledby="about-next">
          <h2 id="about-next" className="font-serif text-2xl font-bold">Get started</h2>
          <p className="mt-2">Review how the service handles information and the expectations for using shared gear before requesting access.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild><Link to="/join">Request membership</Link></Button>
            <Button variant="outline" asChild><Link to="/">Sign in</Link></Button>
          </div>
          <p className="mt-4 text-sm">Read the <Link className="text-terracotta underline" to="/privacy">Privacy notice</Link> and <Link className="text-terracotta underline" to="/terms">Terms of use</Link>.</p>
        </section>
      </div>
    </PublicInformationLayout>
  );
}
