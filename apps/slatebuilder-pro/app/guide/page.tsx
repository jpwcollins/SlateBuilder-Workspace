export const metadata = {
  title: "SlateBuilder Pro — User guide",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-slateBlue-900">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-6 text-sand-800">{children}</div>
    </section>
  );
}

export default function Guide() {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-wide text-sand-600">User guide</p>
        <h1 className="text-3xl font-semibold text-slateBlue-900">SlateBuilder Pro</h1>
        <p className="text-sm text-sand-700">
          Build single-surgeon OR slates and priority waitlists from a deidentified list. Everything
          runs in your browser — nothing is uploaded.
        </p>
        <a
          href="/"
          className="mt-1 w-fit rounded-lg border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
        >
          ← Back to the app
        </a>
      </header>

      <Section title="1. Load the waitlist">
        <p>Upload a deidentified CSV. Each row is one case; the importer reads:</p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">source_key</span> — an anonymous case identifier
          </li>
          <li>
            <span className="font-semibold">benchmark</span> — the urgency class (2w, 4w, 6w, 12w, 26w)
          </li>
          <li>
            <span className="font-semibold">time_to_target_days</span> (or a time-waiting column) —
            how far the patient is from their target
          </li>
          <li>
            <span className="font-semibold">surgeon_id</span> and{" "}
            <span className="font-semibold">procedure_name</span>
          </li>
          <li>clinical flag columns: osa, diabetes, out_of_town, high_bmi, chronic_pain, special_assist</li>
        </ul>
        <p className="rounded-xl border border-sand-200 bg-white/70 px-4 py-3 text-xs text-sand-700">
          <span className="font-semibold text-sand-900">Codes &amp; names:</span> each case gets an
          opaque code (e.g. C-001) used in exports by default. Tick{" "}
          <span className="font-semibold">Include patient names in exported CSVs</span> to add a label
          column.
        </p>
      </Section>

      <Section title="2. Choose OR days and surgeon">
        <ul className="list-disc pl-5">
          <li>Pick up to three OR dates and the surgeon to plan for.</li>
          <li>
            A standard day is 08:00–16:00 (480 min); the 2nd and 4th Thursday of the month run
            09:00–16:00 (420 min).
          </li>
          <li>
            A <span className="font-semibold">30-minute turnaround</span> follows every case but the
            last, and a slate holds at most <span className="font-semibold">7 cases</span>.
          </li>
        </ul>
      </Section>

      <Section title="3. Priority rule & case durations">
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Composite priority</span> (urgency + time waited) is the
            default ranking; &quot;wait time only&quot; sorts purely by time-to-target.
          </li>
          <li>
            Default durations come from the procedure in four buckets (hysteroscopy 30, laparoscopy
            60, hysterectomy 180, other 90 min). Override any case&apos;s duration on its slate card.
            Use <span className="font-semibold">Save default durations</span> to keep your values.
          </li>
        </ul>
      </Section>

      <Section title="4. Review the optimized slates">
        <p>
          Each date&apos;s slate places patients who are already{" "}
          <span className="font-semibold">past target</span> first (most urgent first, so the
          longest-waiting are never bumped), then fills the remaining time to complete as many further
          cases as possible.
        </p>
        <ul className="list-disc pl-5">
          <li>
            On a wide screen the slates sit side by side, one column per day, each in its own
            colour. The capacity bar is green when the day is at least 85% used, amber when it is
            noticeably underused, and red if the cases run past the block.
          </li>
          <li>
            Drag cases to set the running order. Duration is on each card; flags, the
            unavailable-until date and Remove from suggested slates are under{" "}
            <span className="font-semibold">Flags, availability, remove</span>.
          </li>
          <li>
            Date fields (unavailable-until and the OR dates) take effect when you press Enter, click{" "}
            <span className="font-semibold">Set</span>, or move on from the field, not while you
            scroll or type through dates; Escape puts the old date back. An unavailable-until date
            can be at most a year from today.
          </li>
          <li>
            Drag a case onto another day&apos;s slate to move the patient there. The rest of the
            slates are re-planned around that choice: anyone displaced goes to the best day left for
            them, or back to the waitlist if there is no room. You see the list of changes and
            confirm before anything moves; anyone who ranks above the patient you are placing and
            would be pushed later is named first, with how overdue they are, and the same dialog
            asks for the reason for placing them ahead. The placement holds through later edits; patients placed
            by hand are never moved to make room for another.
          </li>
          <li>
            <span className="font-semibold">Remove from suggested slates</span> frees the time for the
            next case; restore from the Priority Waitlist.
          </li>
          <li>
            Export the slate CSV, and the <span className="font-semibold">case mapping</span> (code →
            label) — keep the mapping file secure.
          </li>
        </ul>
      </Section>

      <Section title="Booking order: was each case booked first-in, first-out?">
        <p>
          Every case on a slate carries a mark showing whether it was booked in priority order — the
          order of the Priority Waitlist for the selected surgeon, which within one benchmark class is
          strictly first-in, first-out — and, if not, why. The slate CSV carries the same in its{" "}
          <span className="font-semibold">booking_order</span> and{" "}
          <span className="font-semibold">booking_order_reason</span> columns.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold text-emerald-800">FIFO</span> — nobody who ranks ahead,
            and who was there to be booked for this date, is still waiting or booked later.
          </li>
          <li>
            <span className="font-semibold text-sky-800">Optimization</span> — booked ahead of
            someone higher-ranked because this mix of cases makes best use of the OR time.
          </li>
          <li>
            <span className="font-semibold text-sky-800">Clinical</span> — dragged onto this slate
            by hand, ahead of someone higher-ranked, with a recorded reason or a clinical flag that
            accounts for it.
          </li>
          <li>
            <span className="font-semibold text-rose-700">No reason</span> — dragged onto this slate
            by hand, ahead of someone higher-ranked, with nothing recorded to account for it.
          </li>
        </ul>
        <p>
          A mark is about that case only. Removing a patient from the suggested slates, or dragging
          them to a later day, does not change the marks on the cases behind them. Instead the app
          asks why at the moment you do it (it asks the same when you drag someone onto a slate
          ahead of others); if you skip that, the patient is listed in a red panel at the top of the Slates tab and
          tagged <span className="font-semibold">Reason needed</span> on their Priority Waitlist row,
          and each slate where someone lower-ranked is booked in their place says so in one line. The
          count is in the CSV&apos;s{" "}
          <span className="font-semibold">slate_held_back_no_reason</span> column.
        </p>
        <p>
          A clinical flag on the held-back patient counts as a reason by itself. Passing a patient
          who is unavailable that day does not count, and dragging a case up or down within a slate
          changes only the running order, never its mark. Reasons come from a fixed list; the optional typed note
          beside one is never exported. Reasons last for the session only — this app keeps nothing
          between uploads.
        </p>
      </Section>

      <Section title="5. Priority Waitlist, groups & metrics">
        <ul className="list-disc pl-5">
          <li>
            The Priority Waitlist ranks by composite priority and marks who is already slated. Scope
            it to the selected surgeon or to a <span className="font-semibold">surgeon group</span>.
          </li>
          <li>
            Create groups in <span className="font-semibold">Surgeon Groups</span> to view a combined
            priority list across several surgeons.
          </li>
          <li>
            <span className="font-semibold">Advanced Metrics</span> summarises caseload and
            days-past-target by surgeon (these are time-to-target figures, not measured waits).
          </li>
        </ul>
      </Section>

      <Section title="How the priority score works">
        <p>
          Each case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3, 12w = 2, 26w = 1)
          multiplied by how far the patient has waited toward target. The score climbs every day and
          keeps rising once past target, so urgency and waiting both count — and a breached
          short-target patient outranks a long-overdue long-target one.
        </p>
      </Section>

      <Section title="Tips">
        <ul className="list-disc pl-5">
          <li>Durations drive how many cases fit — adjust per-case estimates for an accurate slate.</li>
          <li>Editing a duration or removing a case re-optimizes the slate, so the set may change.</li>
          <li>All processing is local; no data leaves your browser.</li>
        </ul>
      </Section>

      <footer className="pb-6 text-center text-xs text-sand-500">Generated with SlateBuilder</footer>
    </main>
  );
}
