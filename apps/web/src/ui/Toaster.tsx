import { dismissToast, toast } from '../features/food/toast';
import { Button } from './Button';
import { sheetStack } from './sheetStack';
import { UpdateToast } from './UpdateToast';

/** The message itself, with its action. */
export function ToastView() {
  const tt = toast.value;
  if (!tt) return null;
  return (
    <div class="toast">
      <span>{tt.message}</span>
      {tt.action && (
        <Button
          size="sm"
          onClick={() => {
            tt.action!.run();
            dismissToast();
          }}
        >
          {tt.action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * Transient messages, announced politely, pinned above the tab bar. While a sheet is open the sheet shows
 * the message instead (a modal sheet makes everything outside it untappable, including "Undo").
 */
export function Toaster() {
  const inSheet = sheetStack.value.length > 0;
  return (
    <div class="toast-region stack gap-2" role="status" aria-live="polite">
      {!inSheet && <ToastView />}
      <UpdateToast />
    </div>
  );
}
