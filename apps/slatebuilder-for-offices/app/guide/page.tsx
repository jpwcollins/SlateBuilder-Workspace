export const metadata = {
  title: "SlateBuilder for Offices — User guide",
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
        <p className="text-sm uppercase tracking-[0.26em] text-sand-600">User guide</p>
        <h1 className="text-3xl font-semibold text-slateBlue-900">SlateBuilder for Offices</h1>
        <p className="text-sm text-sand-700">
          A quick guide to turning your office waitlist into OR slates and priority lists. Everything
          runs in your browser — no patient data ever leaves this device.
        </p>
        <a
          href="/"
          className="mt-1 w-fit rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
        >
          ← Back to the app
        </a>
      </header>

      <Section title="1. Load the office waitlist">
        <p>
          Use <span className="font-semibold">Load Office Waitlist</span> to upload your office&apos;s
          own CSV or Excel file. Each row is one patient. The importer reads these columns:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">PAT_NAME1</span> or <span className="font-semibold">PHN</span>{" "}
            — the patient identifier (shown on screen; see privacy below)
          </li>
          <li>
            <span className="font-semibold">SURGEON</span> — used as the surgeon shown on printed
            slates (one surgeon per file)
          </li>
          <li>
            <span className="font-semibold">DIAGNOSIS</span> — the procedure (drives the default case
            duration)
          </li>
          <li>
            <span className="font-semibold">TARGET_TIME</span> and{" "}
            <span className="font-semibold">TIME_WAITING</span> — both in{" "}
            <span className="font-semibold">weeks</span>
          </li>
        </ul>
        <p className="rounded-xl border border-sand-200 bg-white/70 px-4 py-3 text-xs text-sand-700">
          <span className="font-semibold text-sand-900">Privacy:</span> each patient is given an
          opaque code (e.g. C-001). Names stay on your screen; exported slates and lists use the code
          by default. Tick <span className="font-semibold">Include patient names in exported CSVs</span>{" "}
          only when you need a named list to work from.
        </p>
      </Section>

      <Section title="2. Set the scheduling rules">
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Priority rule</span> — &quot;composite priority&quot;
            (urgency + time waited) is the default; &quot;wait time only&quot; sorts purely by
            time-to-target.
          </li>
          <li>
            <span className="font-semibold">Default case durations</span> — four buckets
            (hysteroscopy 30, laparoscopy 60, hysterectomy 180, other 90 min). These are starting
            estimates; you can override any case&apos;s duration on its slate card, and most offices
            will want to.
          </li>
          <li>
            <span className="font-semibold">OR dates</span> — choose up to three. A standard day is
            08:00–16:00 (480 min); the 2nd and 4th Thursday of the month run 09:00–16:00 (420 min).
          </li>
        </ul>
        <p>
          A <span className="font-semibold">30-minute turnaround</span> (OR prep) is added after
          every case except the last of the day, and a slate holds a{" "}
          <span className="font-semibold">maximum of 7 cases</span>.
        </p>
      </Section>

      <Section title="3. Review the suggested slates">
        <p>
          For each OR date the tool builds a slate in two steps: it first places every patient who is
          already <span className="font-semibold">past target</span> (most urgent first, so the
          longest-waiting are never bumped), then fills the remaining time with not-yet-overdue cases
          to complete as many further patients as possible.
        </p>
        <ul className="list-disc pl-5">
          <li>The capacity bar shows time used vs. the block, including turnaround.</li>
          <li>Drag cases to reorder them; the order is the running order for the day.</li>
          <li>
            Edit a case&apos;s duration or clinical flags, or set a date a patient is{" "}
            <span className="font-semibold">unavailable until</span>. If that date falls on or after a
            slate the patient is already on, they&apos;re automatically pulled off that slate and placed
            on the next later slate that has room (skipping any locked slate); if nothing fits, they
            drop back to the waitlist as not-yet-slated. Use the{" "}
            <span className="font-semibold">Clear</span> button next to the date to remove the
            unavailability entirely — this does not automatically re-slate the patient.
          </li>
          <li>
            <span className="font-semibold">Remove from suggested slates</span> takes a case off; the
            freed time is offered to the next patient. Restore it from the Priority Waitlist.
          </li>
          <li>
            Export each slate as a one-page <span className="font-semibold">PDF</span> (surgeon and
            date prominent, room for handwritten notes), as a <span className="font-semibold">CSV</span>,
            or all slates at once. <span className="font-semibold">Export all slates (PDF)</span> is at
            the top of the section.
          </li>
        </ul>
      </Section>

      <Section title="4. Work from the Priority Waitlist">
        <p>
          The Priority Waitlist ranks the whole office by composite priority and marks each patient{" "}
          <span className="font-semibold">Slated</span> or <span className="font-semibold">Waiting</span>,
          so staff can work from one list. Export it as a PDF or CSV.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Remove from waitlist</span> (trash icon) takes a patient off
            the list entirely, off any slate, and opens a pre-filled email to booking asking for them to
            be removed from the source system. The row stays visible, greyed out and struck through, so
            the removal is auditable. Click <span className="font-semibold">Restore to waitlist</span>{" "}
            on that row to reverse it — the patient reappears as not-yet-slated (you&apos;ll need to
            drag them onto a slate again if needed).
          </li>
          <li>
            A <span className="font-semibold">Patients with a period of unavailability</span> panel sits
            at the bottom of the waitlist, listing everyone with an unavailable-until date, soonest
            first, with a one-click <span className="font-semibold">Clear</span>. They remain in the
            main list above too — this panel is just a quick way to see who has an upcoming hold.
          </li>
        </ul>
      </Section>

      <Section title="Office snapshot & waitlist overview">
        <p>
          The snapshot shows totals (cases, overdue, urgent, workload). The{" "}
          <span className="font-semibold">Waitlist overview</span> histogram breaks each benchmark
          class (2w–26w) into bands: well under target, approaching target, recently overdue, and
          well overdue — a quick read of where pressure is building.
        </p>
      </Section>

      <Section title="Long-waiters (over target)">
        <p>
          This section lists every patient already past their target, grouped by urgency class and
          most-overdue-first. These are the patients guaranteed onto slates before any not-yet-overdue
          case. Export the full list as PDF or CSV to review or circulate.
        </p>
      </Section>

      <Section title="How the priority score works">
        <p>
          Each case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3, 12w = 2, 26w = 1)
          multiplied by how far the patient has waited toward their target. The score climbs every day
          and keeps rising once a patient is past target, so urgency and waiting time both count — and
          a breached short-target patient outranks a long-overdue long-target one.
        </p>
      </Section>

      <Section title="Saving &amp; sharing your work">
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Sign in</span> (Office account &amp; sync) to save your
            work to the cloud and share draft slates across devices with your team. Only
            pseudonymized, encrypted data is stored — never names, PHNs, or diagnoses.
          </li>
          <li>
            Once signed in, changes <span className="font-semibold">sync automatically</span>. Sign in
            on another device and upload the same waitlist to pick up where you left off; mark a plan{" "}
            <span className="font-semibold">finalized</span> when it&apos;s ready.
          </li>
          <li>
            Unavailable dates and other edits <span className="font-semibold">persist across monthly
            uploads</span>, so you don&apos;t re-enter them each time.
          </li>
          <li>
            If you&apos;re not signed in, work is still{" "}
            <span className="font-semibold">autosaved for the current browser tab</span> and cleared
            when you close it.
          </li>
          <li>
            On a shared office computer, use the{" "}
            <span className="font-semibold">Sign out &amp; reset</span> /{" "}
            <span className="font-semibold">Reset device data</span> button in the top bar (visible on
            every tab, signed in or not) before walking away. It clears everything held on this device —
            the uploaded list, every edit, and the tab autosave — and signs you out if you were signed
            in. It does not delete anything already saved to the cloud.
          </li>
        </ul>
      </Section>

      <Section title="Privacy &amp; security, in plain language">
        <p>
          The short version: <span className="font-semibold">patient names, PHNs, and diagnoses never
          leave your computer</span>. Only your browser ever sees them. What gets saved to the cloud (so
          your team can share drafts across devices) is a scrambled, locked version of your working
          data that the server itself cannot read.
        </p>
        <p className="font-semibold text-sand-900">How a patient is identified in the cloud</p>
        <p>
          When you sign in, your office password unlocks a secret &quot;office key&quot; that only ever
          exists in your browser&apos;s memory — it is never sent to the server, even in encrypted form
          that could later be unlocked there. Each patient&apos;s PHN is combined with that office key
          and run through a one-way scrambling function (the same family of math banks use to store
          passwords). The result is a meaningless string of characters — a &quot;patient token&quot;.
          It&apos;s consistent from month to month (so re-uploading the waitlist still recognizes the
          same patient), but there is no mathematical way to run it backwards to recover the PHN. Only
          someone who already has your office key and the original PHN could reproduce the same token —
          the server, which never has the office key, cannot.
        </p>
        <p className="font-semibold text-sand-900">How your working data is protected</p>
        <p>
          Everything else — durations, flags, unavailable dates, which patient is on which slate — is
          bundled up and locked with the same office key using a standard, widely-audited encryption
          method (AES-256, the same class of encryption used for online banking). What lands on the
          server is an opaque, locked blob plus your password&apos;s hash (never the password itself,
          and hashed in a deliberately slow way designed to resist guessing). The server stores the box;
          it does not hold the key.
        </p>
        <p className="font-semibold text-sand-900">
          Worst case: what if the database itself was hacked?
        </p>
        <p>
          If an attacker broke into the cloud database directly, here is exactly what they would find,
          and what it would get them:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Locked working-data blobs</span> — unreadable without the
            office key, which was never stored there. The attacker would see ciphertext, not case
            details.
          </li>
          <li>
            <span className="font-semibold">Patient tokens</span> inside those blobs — even once
            decrypted (which they can&apos;t be), these are one-way scrambled values, not PHNs or names.
            There is no feasible way to reverse them back to a real patient.
          </li>
          <li>
            <span className="font-semibold">Password hashes</span>, not passwords — cracking one to
            recover the real office password would take a deliberately impractical amount of computing
            time, especially for a reasonably strong password.
          </li>
          <li>
            <span className="font-semibold">Office keys, but wrapped (double-locked)</span> — the office
            key itself is also stored only in an encrypted form that requires the office password to
            open. Without the password, it&apos;s just as unreadable as everything else.
          </li>
        </ul>
        <p>
          In short: a full database breach would hand an attacker a pile of locked boxes and
          scrambled labels, with no names, PHNs, or diagnoses anywhere in it, and no practical way to
          unlock any of it without also separately compromising an office&apos;s actual password. The
          one thing worth taking seriously from this: choose a real office password (not something
          guessable), since it is the one piece that, combined with a breach, is the theoretical weak
          point. Everything else in the design assumes the server itself may someday be compromised, and
          is built so that a breach alone still isn&apos;t enough to expose a patient.
        </p>
      </Section>

      <Section title="Tips & troubleshooting">
        <ul className="list-disc pl-5">
          <li>Set a date for every slate — an amber banner warns about missing, duplicate, or past dates.</li>
          <li>Upload one surgeon&apos;s file at a time; a banner warns if it detects several.</li>
          <li>Durations drive how many cases fit — adjust per-case estimates for an accurate slate.</li>
          <li>If the slate looks empty, check the file includes TARGET_TIME and TIME_WAITING.</li>
        </ul>
      </Section>

      <footer className="pb-6 text-center text-xs text-sand-500">Generated with SlateBuilder</footer>
    </main>
  );
}
