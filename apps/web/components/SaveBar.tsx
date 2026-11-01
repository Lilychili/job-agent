"use client";

export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

/** Status line + buttons at the bottom of a form. */
export function SaveBar({
  state,
  dirty,
  children,
}: {
  state: SaveState;
  dirty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="savebar">
      <p className={`save-status ${state.kind}`} role="status" aria-live="polite">
        {state.kind === "saving" && "Saving…"}
        {state.kind === "saved" && `✓ ${state.message}`}
        {state.kind === "error" && state.message}
        {state.kind === "idle" && (dirty ? "Unsaved changes" : "")}
      </p>
      <div className="actions">{children}</div>
    </div>
  );
}
