import { useState } from "react";
import type { Dialog } from "../shared/protocol";
export function DialogCard({
  dialog,
  answer,
  disabled,
}: {
  dialog: Dialog;
  answer: (value: string | boolean, cancelled: boolean) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState(dialog.prefill);
  return (
    <form
      className="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        answer(value, false);
      }}
    >
      <h3>{dialog.title}</h3>
      {dialog.message && <p>{dialog.message}</p>}
      {dialog.kind === "select" ? (
        <div className="choices">
          {dialog.options.map((o) => (
            <button
              type="button"
              disabled={disabled}
              key={o}
              onClick={() => answer(o, false)}
            >
              {o}
            </button>
          ))}
        </div>
      ) : dialog.kind === "confirm" ? (
        <div className="choices">
          <button
            type="button"
            disabled={disabled}
            onClick={() => answer(true, false)}
          >
            Allow
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => answer(false, false)}
          >
            Decline
          </button>
        </div>
      ) : (
        <>
          <textarea
            aria-label={dialog.title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={dialog.kind === "editor" ? 6 : 2}
          />
          <button disabled={disabled}>Submit</button>
        </>
      )}
      <button
        type="button"
        className="subtle"
        disabled={disabled}
        onClick={() => answer("", true)}
      >
        Cancel
      </button>
    </form>
  );
}
