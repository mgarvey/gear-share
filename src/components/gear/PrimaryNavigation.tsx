import {
  Bell,
  Boxes,
  ChevronDown,
  ClipboardList,
  LogOut,
  Menu,
  PackagePlus,
  Plus,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { fetchPrivateNotifications } from "@/lib/gearShareApi";
import type { Membership } from "@/types/gear";

const primary = [
  ["/catalog", "Browse"],
  ["/my-gear", "My gear"],
  ["/loans", "Loans"],
  ["/wanted", "Wanted"],
] as const;

function AppNav({ to, children }: { to: string; children: React.ReactNode }) {
  return <NavLink to={to} className={({ isActive }) => `rounded-md px-3 py-2 font-medium transition-colors ${isActive ? "bg-white text-primary" : "text-white hover:bg-white/15"}`}>{children}</NavLink>;
}

function SecondaryLinks({ accessLevel, mobile = false }: Pick<Membership, "accessLevel"> & { mobile?: boolean }) {
  const links = [
    ["/account", "Account settings", UserRound],
    ...(accessLevel !== "regular" ? [["/inventory", "Group inventory", Boxes] as const] : []),
    ...(accessLevel === "administrator" ? [["/administration", "Administration", ShieldCheck] as const] : []),
    ["/privacy", "Privacy", ClipboardList],
  ] as const;
  if (mobile) return <>{links.map(([to, label, Icon]) => <SheetClose key={to} asChild><NavLink to={to} className="flex min-h-12 items-center gap-3 rounded-md px-3 py-3 font-medium hover:bg-muted"><Icon className="h-5 w-5" aria-hidden="true" />{label}</NavLink></SheetClose>)}</>;
  return <>{links.map(([to, label, Icon]) => <DropdownMenuItem key={to} asChild><NavLink to={to} className="gap-2"><Icon className="h-4 w-4" aria-hidden="true" />{label}</NavLink></DropdownMenuItem>)}</>;
}

function AddGearActions({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return <div className="grid gap-2"><SheetClose asChild><Button className="min-h-12 justify-start text-base" asChild><NavLink to="/my-gear?add=1"><Plus aria-hidden="true" />Add gear</NavLink></Button></SheetClose><SheetClose asChild><Button variant="outline" className="min-h-12 justify-start text-base" asChild><NavLink to="/bulk-intake"><PackagePlus aria-hidden="true" />Add gear in bulk</NavLink></Button></SheetClose></div>;
  }
  return <><Button className="bg-white text-primary hover:bg-white/90" size="sm" asChild><NavLink to="/my-gear?add=1"><Plus aria-hidden="true" />Add gear</NavLink></Button><Button variant="outline" className="border-white/50 bg-transparent text-white hover:bg-white hover:text-primary" size="sm" asChild><NavLink to="/bulk-intake"><PackagePlus aria-hidden="true" />Add in bulk</NavLink></Button></>;
}

function NotificationBell({ hasUnread }: { hasUnread: boolean }) {
  return <span className="relative inline-flex"><Bell className="h-5 w-5" aria-hidden="true" />{hasUnread ? <span data-unread-notification-indicator className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-300 ring-1 ring-primary" aria-hidden="true" /> : null}</span>;
}

async function hasUnreadPrivateNotifications() {
  let cursor: { occurredAt: string; id: string } | undefined;
  for (;;) {
    const page = await fetchPrivateNotifications(cursor);
    if (page.some((notification) => !notification.readAt)) return true;
    if (page.length < 30) return false;
    const last = page[page.length - 1];
    cursor = { occurredAt: last.occurredAt, id: last.id };
  }
}

export function PrimaryNavigation({ accessLevel, onSignOut }: Pick<Membership, "accessLevel"> & { onSignOut: () => void }) {
  const notifications = useQuery({
    queryKey: ["private-notifications", "unread-indicator"],
    queryFn: hasUnreadPrivateNotifications,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const hasUnread = notifications.data ?? false;
  return <>
    <nav aria-label="Primary" className="hidden items-center gap-1 text-sm md:flex">
      {primary.map(([to, label]) => <AppNav key={to} to={to}>{label}</AppNav>)}
    </nav>
    <div className="ml-auto hidden items-center gap-1 md:flex">
      <AddGearActions />
      <Button variant="ghost" size="icon" className="text-white hover:bg-white/15 hover:text-white" asChild><NavLink to="/notifications" aria-label={hasUnread ? "Notifications, unread" : "Notifications"}><NotificationBell hasUnread={hasUnread} /></NavLink></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2 border-white/40 bg-white/10 text-white hover:bg-white hover:text-primary"><UserRound className="h-4 w-4" />Account<ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel>Gear share</DropdownMenuLabel><DropdownMenuSeparator /><SecondaryLinks accessLevel={accessLevel} /><DropdownMenuSeparator /><DropdownMenuItem className="gap-2" onSelect={onSignOut}><LogOut className="h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Sheet>
      <SheetTrigger asChild><Button variant="outline" size="icon" className="ml-auto h-11 w-11 border-white/40 bg-white/10 text-white hover:bg-white hover:text-primary md:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></Button></SheetTrigger>
      <SheetContent className="flex w-[min(20rem,calc(100vw-3rem))] flex-col overflow-y-auto"><SheetHeader><SheetTitle>Menu</SheetTitle><SheetDescription className="sr-only">Navigate the gear share.</SheetDescription></SheetHeader><nav aria-label="Mobile" className="mt-6 flex flex-col gap-1"><AddGearActions mobile /><div className="my-2 border-t" />{primary.map(([to, label]) => <SheetClose key={to} asChild><NavLink to={to} className="flex min-h-12 items-center rounded-md px-3 py-3 font-medium hover:bg-muted">{label}</NavLink></SheetClose>)}<SheetClose asChild><NavLink to="/notifications" className="flex min-h-12 items-center gap-3 rounded-md px-3 py-3 font-medium hover:bg-muted" aria-label={hasUnread ? "Notifications, unread" : "Notifications"}><NotificationBell hasUnread={hasUnread} />Notifications{hasUnread ? <span className="ml-auto rounded-full bg-terracotta px-2 py-0.5 text-xs text-white">Unread</span> : null}</NavLink></SheetClose><div className="my-2 border-t" /><SecondaryLinks accessLevel={accessLevel} mobile /><div className="my-2 border-t" /><SheetClose asChild><button type="button" className="flex min-h-12 items-center gap-3 rounded-md px-3 py-3 text-left font-medium hover:bg-muted" onClick={onSignOut}><LogOut className="h-5 w-5" />Sign out</button></SheetClose></nav></SheetContent>
    </Sheet>
  </>;
}
