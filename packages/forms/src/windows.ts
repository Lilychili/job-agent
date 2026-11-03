// Prefilled forms stay open for the owner to submit, one tab per application in the Shipper's window.
// The worker closes a tab when its application moves on, and the window when it stops.
import { closeShipperBrowser, type FormSession } from "./session";

const open = new Map<string, FormSession>();

export function holdWindow(applicationId: string, session: FormSession): void {
  open.set(applicationId, session);
}

/** The application's window, if the owner hasn't closed it. */
export function heldWindow(applicationId: string): FormSession | null {
  const s = open.get(applicationId);
  if (s?.isOpen) return s;
  open.delete(applicationId);
  return null;
}

export async function closeWindow(applicationId: string): Promise<void> {
  const s = open.get(applicationId);
  open.delete(applicationId);
  await s?.close();
}

export async function closeAllWindows(): Promise<void> {
  await Promise.all([...open.keys()].map(closeWindow));
  await closeShipperBrowser();
}
