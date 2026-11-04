import { redirect } from "next/navigation";
import { loadBoard } from "@/lib/board";
import { loadSetupStatus, setupProgress } from "@/lib/data";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const progress = setupProgress(await loadSetupStatus());
  if (!progress.started) redirect("/welcome");
  const initial = await loadBoard();
  return <Board initial={initial} setup={progress.ready ? null : progress} />;
}
