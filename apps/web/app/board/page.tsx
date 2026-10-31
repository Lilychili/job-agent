import { loadBoard } from "@/lib/board";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const initial = await loadBoard();
  return <Board initial={initial} />;
}
