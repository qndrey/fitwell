import { dismissToast, toast } from '../features/food/toast';

export function Toaster() {
  const tt = toast.value;
  return (
    <div class="toast-region" role="status" aria-live="polite">
      {tt && (
        <div class="toast">
          <span>{tt.message}</span>
          {tt.action && (
            <button
              class="btn"
              onClick={() => {
                tt.action!.run();
                dismissToast();
              }}
            >
              {tt.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
