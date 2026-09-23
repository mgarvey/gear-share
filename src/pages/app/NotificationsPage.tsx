import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { dismissAllNotifications, dismissNotification, fetchPrivateNotifications, setNotificationRead } from "@/lib/gearShareApi";

export default function NotificationsPage() {
  const client = useQueryClient();
  const notifications = useInfiniteQuery({
    queryKey: ["private-notifications"],
    initialPageParam: undefined as { occurredAt: string; id: string } | undefined,
    queryFn: ({ pageParam }) => fetchPrivateNotifications(pageParam),
    getNextPageParam: (lastPage) => lastPage.length === 30
      ? { occurredAt: lastPage[29].occurredAt, id: lastPage[29].id }
      : undefined,
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["private-notifications"] });
  const read = useMutation({ mutationFn: ({ id, value }: { id: string; value: boolean }) => setNotificationRead(id, value), onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: (id: string) => dismissNotification(id), onSuccess: refresh });
  const dismissAll = useMutation({ mutationFn: dismissAllNotifications, onSuccess: refresh });

  if (notifications.isLoading) return <main className="container mx-auto p-4 md:p-8">Loading notifications…</main>;
  if (notifications.error) return <main className="container mx-auto p-4 md:p-8" role="alert"><p>{(notifications.error as Error).message}</p><Button className="mt-4" onClick={() => void notifications.refetch()}>Try again</Button></main>;
  const rows = notifications.data?.pages.flat() ?? [];
  return <main className="container mx-auto p-4 md:p-8 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-serif text-3xl font-bold">Notifications</h1><p className="text-muted-foreground">Updates about your membership, loans, and wanted gear.</p></div>{rows.length > 0 ? <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" disabled={dismissAll.isPending}>{dismissAll.isPending ? "Dismissing…" : "Dismiss all"}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Dismiss all notifications?</AlertDialogTitle><AlertDialogDescription>This removes every notification from your notification center, including older notifications you have not loaded. It does not change the related membership, loan, or wanted gear activity.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep notifications</AlertDialogCancel><AlertDialogAction onClick={() => dismissAll.mutate()}>Dismiss all</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}</div>
    {rows.length === 0 ? <Card><CardContent className="py-8 text-center text-muted-foreground">You have no notifications yet.</CardContent></Card> : <div className="space-y-3">
      {rows.map((notification) => <Card key={notification.id} className={notification.readAt ? "" : "border-terracotta"}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link className="font-semibold underline-offset-4 hover:underline" to={notification.appRoute}>{notification.title}</Link>{notification.readAt ? null : <span className="rounded-full bg-terracotta px-2 py-0.5 text-xs text-white">Unread</span>}</div><p className="mt-1 text-sm text-muted-foreground">{notification.body}</p><time className="mt-2 block text-xs text-muted-foreground" dateTime={notification.occurredAt}>{new Date(notification.occurredAt).toLocaleString()}</time></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={read.isPending && read.variables?.id === notification.id} onClick={() => read.mutate({ id: notification.id, value: !notification.readAt })}>{notification.readAt ? "Mark unread" : "Mark read"}</Button><Button size="sm" variant="ghost" disabled={dismiss.isPending && dismiss.variables === notification.id} onClick={() => dismiss.mutate(notification.id)}>Dismiss</Button></div>
      </CardContent></Card>)}
    </div>}
    {read.error || dismiss.error || dismissAll.error ? <p role="alert" className="text-sm text-destructive">{((read.error ?? dismiss.error ?? dismissAll.error) as Error).message}</p> : null}
    {notifications.hasNextPage ? <Button variant="outline" disabled={notifications.isFetchingNextPage} onClick={() => void notifications.fetchNextPage()}>{notifications.isFetchingNextPage ? "Loading…" : "Load older notifications"}</Button> : null}
  </main>;
}
