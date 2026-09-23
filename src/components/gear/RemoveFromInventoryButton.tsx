import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function RemoveFromInventoryButton({
  title,
  onConfirm,
  label = "Remove from inventory",
}: {
  title: string;
  onConfirm: () => void;
  label?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild><Button size="sm" variant="destructive">{label}</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {title} from inventory?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from the catalog and stops new borrowing requests. Past loan history is kept.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep item</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Remove from inventory</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
