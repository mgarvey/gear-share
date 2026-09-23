import { Suspense, lazy, useEffect, useRef } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageOpen } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Auth } from "@/components/gear/Auth";
import { MembershipApplication } from "@/components/gear/MembershipApplication";
import { RouteLoadBoundary } from "@/components/gear/RouteLoadBoundary";
import { LegacyManagementRedirect } from "@/components/gear/LegacyManagementRedirect";
import { PrimaryNavigation } from "@/components/gear/PrimaryNavigation";
import { communityLogoUrl, communityName, gearShareName } from "@/config/community";
import { configuredPrivacyContactUrl } from "@/config/publicOrigin";
import { fetchCommunitySettings, fetchMembership } from "@/lib/gearShareApi";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const loadCatalogPage = () => import("@/pages/app/CatalogPage");
const loadMyGearPage = () => import("@/pages/app/MyGearPage");
const loadLoansPage = () => import("@/pages/app/LoansPage");
const loadInventoryPage = () => import("@/pages/app/InventoryPage");
const loadAdministrationPage = () => import("@/pages/app/AdministrationPage");
const loadManageGearPage = () => import("@/pages/app/ManageGearPage");
const loadCopyGearPage = () => import("@/pages/app/CopyGearPage");
const loadGearDetailPage = () => import("@/pages/app/GearDetailPage");
const loadAccountPage = () => import("@/pages/app/AccountPage");
const loadNotificationsPage = () => import("@/pages/app/NotificationsPage");
const loadWantedPage = () => import("@/pages/app/WantedPage");
const loadBulkIntakePage = () => import("@/pages/app/BulkIntakePage");
const CatalogPage = lazy(loadCatalogPage);
const MyGearPage = lazy(loadMyGearPage);
const LoansPage = lazy(loadLoansPage);
const InventoryPage = lazy(loadInventoryPage);
const AdministrationPage = lazy(loadAdministrationPage);
const ManageGearPage = lazy(loadManageGearPage);
const CopyGearPage = lazy(loadCopyGearPage);
const GearDetailPage = lazy(loadGearDetailPage);
const AccountPage = lazy(loadAccountPage);
const NotificationsPage = lazy(loadNotificationsPage);
const WantedPage = lazy(loadWantedPage);
const BulkIntakePage = lazy(loadBulkIntakePage);
const PasswordRecoveryPage = lazy(() => import("@/pages/app/PasswordRecoveryPage"));
const JoinPage = lazy(() => import("@/pages/app/JoinPage"));
const PrivacyTermsPage = lazy(() => import("@/pages/app/PrivacyTermsPage"));
const AboutPage = lazy(() => import("@/pages/app/AboutPage"));
const TermsPage = lazy(() => import("@/pages/app/TermsPage"));

function preloadLikelyRoute(pathname: string) {
  const loader = pathname.startsWith("/my-gear") ? loadMyGearPage
    : pathname.startsWith("/loans") ? loadLoansPage
      : pathname.startsWith("/inventory") ? loadInventoryPage
        : pathname.startsWith("/administration") ? loadAdministrationPage
          : pathname.startsWith("/account") ? loadAccountPage
            : pathname.startsWith("/notifications") ? loadNotificationsPage
              : pathname.startsWith("/wanted") ? loadWantedPage
                : pathname.startsWith("/bulk-intake") ? loadBulkIntakePage
                  : pathname.endsWith("/manage") ? loadManageGearPage
                    : pathname.endsWith("/copy") ? loadCopyGearPage
                      : pathname.startsWith("/gear/") ? loadGearDetailPage
                        : loadCatalogPage;
  void loader().catch(() => undefined);
}

function BrandHeader({ accessLevel, onSignOut }: { accessLevel?: "regular" | "custodian" | "administrator"; onSignOut?: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-primary text-primary-foreground shadow-sm">
      <div className="container mx-auto flex min-h-20 flex-wrap items-center gap-4 px-4 py-2">
        <NavLink to="/catalog" className="mr-auto flex min-w-0 items-center gap-3 text-white">
          <img src={communityLogoUrl} alt="" className="h-14 w-12 shrink-0 object-contain" />
          <span className="min-w-0"><strong className="block truncate font-sans text-lg leading-tight sm:text-xl">{communityName}</strong><span className="block text-sm font-medium text-white/90">Gear Share</span><span className="hidden text-xs text-white/70 sm:block">Use it. Return it. Help others.</span></span>
        </NavLink>
        {accessLevel && onSignOut ? <PrimaryNavigation accessLevel={accessLevel} onSignOut={onSignOut} /> : null}
      </div>
    </header>
  );
}

function ContentSkeleton() {
  return (
    <main className="container mx-auto px-4 py-6" aria-label="Loading your gear">
      <div className="mb-6 h-9 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((item) => <div key={item} className="h-56 animate-pulse rounded-xl border bg-muted/70" />)}
      </div>
    </main>
  );
}

function AppLoadingShell() {
  return <div className="min-h-screen bg-background"><BrandHeader /><ContentSkeleton /></div>;
}

function ScrollToPageStart({ identityKey }: { identityKey: string | null }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [identityKey, pathname]);
  return null;
}

export function MemberApplication() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  };
  const membership = useQuery({
    queryKey: ["gear-share-membership", user?.id],
    queryFn: fetchMembership,
    enabled: Boolean(user),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchInterval: (query) => query.state.data?.status === "active" ? 5 * 60_000 : 30_000,
    refetchOnWindowFocus: true,
  });
  const communitySettings = useQuery({
    queryKey: ["community-settings"],
    queryFn: fetchCommunitySettings,
    enabled: membership.data?.status === "active",
  });
  useEffect(() => {
    if (communitySettings.data) document.title = communitySettings.data.displayName;
  }, [communitySettings.data]);

  if (membership.isLoading) return <AppLoadingShell />;
  if (membership.error) {
    return <StatusScreen title="We couldn’t load your membership" detail={(membership.error as Error).message} />;
  }
  if (!membership.data) return <StatusScreen title="Membership profile unavailable" detail="Ask an Administrator to check your signup." />;
  if (membership.data.status !== "active") {
    const copy = {
      pending: ["Membership awaiting approval", "An Administrator must approve your membership before the private catalog is available."],
      rejected: ["Membership request was not approved", "An Administrator can allow you to submit a new application. Use the contact link below to ask for help."],
      deactivated: ["Membership deactivated", "An Administrator can review restoration to Regular access. Prior roles, loans, and gear assignments are not automatically restored."],
    }[membership.data.status];
    return <StatusScreen title={copy[0]} detail={copy[1]}>{membership.data.status === "pending" ? <MembershipApplication userId={membership.data.id} /> : <Button variant="outline" asChild><a href={configuredPrivacyContactUrl()}>Contact an Administrator</a></Button>}</StatusScreen>;
  }

  return (
    <div className="min-h-screen bg-background">
      <BrandHeader accessLevel={membership.data.accessLevel} onSignOut={() => void signOut()} />
      <Suspense fallback={<ContentSkeleton />}>
        <Routes>
          <Route path="/catalog" element={<CatalogPage membership={membership.data} />} />
          <Route path="/my-gear" element={<MyGearPage membership={membership.data} />} />
          <Route path="/loans" element={<LoansPage membership={membership.data} />} />
          <Route path="/account" element={<AccountPage userId={membership.data.id} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/wanted" element={<WantedPage membership={membership.data} />} />
          <Route path="/bulk-intake" element={<BulkIntakePage membership={membership.data} />} />
          <Route path="/inventory" element={membership.data.accessLevel !== "regular" ? <InventoryPage membership={membership.data} /> : <Navigate to="/catalog" replace />} />
          <Route path="/administration" element={membership.data.accessLevel === "administrator" ? <AdministrationPage membership={membership.data} /> : <Navigate to={membership.data.accessLevel === "custodian" ? "/inventory" : "/catalog"} replace />} />
          <Route path="/manage" element={<LegacyManagementRedirect accessLevel={membership.data.accessLevel} />} />
          <Route path="/steward" element={<LegacyManagementRedirect accessLevel={membership.data.accessLevel} />} />
          <Route path="/gear/:supplyId" element={<GearDetailPage membership={membership.data} />} />
          <Route path="/gear/:supplyId/manage" element={<ManageGearPage membership={membership.data} />} />
          <Route path="/gear/:supplyId/copy" element={<CopyGearPage />} />
          <Route path="*" element={<Navigate to="/catalog" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

function StatusScreen({ title, detail, children }: { title: string; detail: string; children?: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center bg-background px-5">
      <div className="max-w-xl w-full text-center bg-white border rounded-xl p-6 shadow-sm sm:p-8">
        <PackageOpen className="h-10 w-10 mx-auto mb-4 text-terracotta" />
        <h1 className="font-serif text-2xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground mb-6">{detail}</p>
        {children ? <div className="mb-6 flex justify-center">{children}</div> : null}
        <Button variant="outline" onClick={() => void supabase.auth.signOut()}>Sign out</Button>
      </div>
    </main>
  );
}

function App() {
  const { user, isReady } = useAuth();
  const queryClient = useQueryClient();
  const priorUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => { document.title = gearShareName; }, []);
  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (priorUserId.current !== undefined && priorUserId.current !== null && priorUserId.current !== nextUserId) queryClient.clear();
    priorUserId.current = nextUserId;
  }, [queryClient, user?.id]);
  useEffect(() => {
    if (user?.id) preloadLikelyRoute(window.location.pathname);
  }, [user?.id]);
  return (
    <BrowserRouter>
      <ScrollToPageStart identityKey={user?.id ?? null} />
      <Toaster />
      <Sonner />
      <RouteLoadBoundary>
        <Routes>
          <Route path="/reset-password" element={<Suspense fallback={<AppLoadingShell />}><PasswordRecoveryPage /></Suspense>} />
          <Route path="/join" element={!isReady ? <AppLoadingShell /> : user ? <MemberApplication /> : <Suspense fallback={<AppLoadingShell />}><JoinPage /></Suspense>} />
          <Route path="/about" element={<Suspense fallback={<AppLoadingShell />}><AboutPage /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={<AppLoadingShell />}><PrivacyTermsPage /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<AppLoadingShell />}><TermsPage /></Suspense>} />
          <Route path="*" element={!isReady ? <AppLoadingShell /> : user ? <MemberApplication /> : <Auth />} />
        </Routes>
      </RouteLoadBoundary>
    </BrowserRouter>
  );
}

export default App;
