import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** Small confirmation dialog for destructive or hard-to-undo actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-md text-sm font-medium bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            className={`px-4 py-2 rounded-md text-sm font-semibold transition-opacity hover:opacity-90 ${
              destructive
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
