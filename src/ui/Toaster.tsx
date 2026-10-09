import { dismissToast, toast } from '../features/food/toast';
import { Button } from './Button';
import { UpdateToast } from './UpdateToast';

/** Transient messages, announced politely, pinned above the tab bar. */
export function Toaster() {
  const tt = toast.value;
  return (
    <div class="toast-region stack gap-2" role="status" aria-live="polite">
      {tt && (
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
      )}
      <UpdateToast />
    </div>
  );
}
