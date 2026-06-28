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
        <p className="text-sm uppercase tracking-[0.2em] text-sand-600">User guide</p>
        <h1 className="text-3xl font-semibold text-slateBlue-900">SlateBuilder Pro</h1>
        <p className="text-sm text-sand-700">
          Build single-surgeon OR slates and priority waitlists from a deidentified list. Everything
          runs in your browser — nothing is uploaded.
        </p>
        <a
          href="/"
          className="mt-1 w-fit rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
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
          <li>Drag cases to set the running order; edit durations, flags or unavailability.</li>
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
