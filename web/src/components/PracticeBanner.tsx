import { inPractice, useEdition } from "../lib/edition";
import { date } from "../lib/format";

/** Shown before the official start when a practice period is set. */
export function PracticeBanner() {
  const ed = useEdition();
  if (!inPractice(ed)) return null;
  return (
    <div className="notice warn practice-banner">
      <b>Practice period until the start on {date(ed.start)}.</b> Orders are already executed at the daily close and results are live, but they are a warm-up:
      on {date(ed.start)} every team restarts from € 1,000,000, the positions still open are carried over at that day's closing prices, and practice gains and losses are reset.
    </div>
  );
}
