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
            <span className="font-semibold">Priority rule</span> — this one lives on the{" "}
            <span className="font-semibold">Priority waitlist</span> tab, where you can see its effect
            as you change it. &quot;Urgency first, then wait time&quot; is the default; &quot;wait time
            only&quot; sorts purely by time-to-target.
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
            <span className="font-semibold">Lock slate</span> freezes a slate&apos;s composition —
            patients can&apos;t be added or removed (drag is rejected), though durations and flags on
            existing cases can still be edited. Locked slates and their patients are skipped entirely
            by Optimize Utilization below.
          </li>
          <li>
            <span className="font-semibold">Optimize Utilization</span> repacks every{" "}
            <span className="font-semibold">unlocked</span> slate to fit in as much OR time as
            possible. Over-target patients are placed first, most overdue first, and are never bumped
            in favor of a not-yet-overdue one — though which slate an over-target patient lands on can
            change. A not-yet-overdue patient can still be bumped back to the waitlist if a
            better-fitting mix of cases packs the block tighter. The summary that follows lists exactly
            who was added or removed per slate, and separately flags any over-target patient who
            couldn&apos;t be fit into any unlocked slate at all (they return to the waitlist as
            not-yet-slated rather than being silently dropped).
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

      <Section title="Saving your work between weeks">
        <p>
          SlateBuilder has <span className="font-semibold">no accounts and no cloud</span>. The
          waitlist you upload is held in the browser tab you are working in and nowhere else — not on
          this computer&apos;s hard drive, and not on any server. Closing the tab clears it.
        </p>
        <p>
          What is worth keeping from week to week is not the list (the hospital sends a fresh one
          every time) but <span className="font-semibold">your notes on it</span>: who is away until
          when, which cases you have given a longer slot, the clinical flags you have ticked, and
          anyone you have taken off the list. Those you can save.
        </p>
        <ul className="list-disc pl-5">
          <li>
            On the Setup tab, under <span className="font-semibold">Save your notes</span>, choose a
            passphrase and click <span className="font-semibold">Save notes file</span>. A file is
            saved to this computer, locked with that passphrase.
          </li>
          <li>
            The next week, upload the new waitlist first, then load the notes file and enter the same
            passphrase. Your notes are matched to each patient by PHN, so they follow the right person
            even though the new file lists everyone in a different order. Notes for patients who are
            no longer waiting are simply left out.
          </li>
          <li>
            <span className="font-semibold">There is no way to recover a lost passphrase.</span> No
            one — including whoever built this tool — can open the file without it. Keep it where your
            office keeps other confidential passwords.
          </li>
          <li>
            Before walking away from the computer, use <span className="font-semibold">Clear screen</span>{" "}
            in the top bar. It removes the uploaded list and every note from the screen. A notes file
            you have already saved is a separate file and is not affected.
          </li>
          <li>
            Because nothing is written to the browser, <span className="font-semibold">reloading the
            page loses the list</span> and you will need to upload it again. The browser will warn you
            before that happens.
          </li>
        </ul>
      </Section>

      <Section title="Privacy &amp; security, in plain language">
        <p>
          The short version: <span className="font-semibold">nothing you upload leaves this
          computer.</span> There is no account to sign in to and no server holding your data. The
          waitlist is read and sorted inside your browser, much as a spreadsheet works on your own
          machine.
        </p>
        <p className="font-semibold text-sand-900">What happens to the file the hospital sends</p>
        <p>
          When you choose the waitlist file, your browser reads it into memory and works on it there.
          It is not uploaded anywhere. Each patient is given a short code — C-001, C-002 and so on —
          and it is that code, not the name, that appears on exported slates and lists unless you
          deliberately tick the box to include names.
        </p>
        <p className="font-semibold text-sand-900">What is in the notes file, and what is not</p>
        <p>
          The notes file contains each patient&apos;s PHN alongside your notes about them: an
          unavailable date, an adjusted case length, clinical flags, and whether you removed them. The
          PHN is there because it is what lets a note find the right patient in next week&apos;s file.
          It does <span className="font-semibold">not</span> contain patient names, diagnoses, or the
          waitlist itself.
        </p>
        <p>
          That still makes it a health record, and it should be treated like one: keep it wherever
          your office keeps confidential files, and delete it when you no longer need it. It is
          encrypted with AES-256 — the same class of encryption used for online banking — with a key
          derived from your passphrase in a deliberately slow way that makes guessing expensive.
        </p>
        <p className="font-semibold text-sand-900">
          Worst case: what if someone got hold of the notes file?
        </p>
        <p>
          Everything rests on the passphrase. Someone who copied the file but does not have the
          passphrase has an unreadable block of ciphertext — and even opened, it holds no names and no
          diagnoses. Someone who has both the file and the passphrase can read your notes, including
          PHNs, which is exactly why the passphrase should be a real one. Several unrelated words
          together are both stronger and easier to remember than a short password with symbols in it.
        </p>
        <p>
          Because there is no server, there is no database to be breached, no account to be taken
          over, and nothing about your patients stored anywhere you cannot see. The trade is that
          safekeeping moves to you: the notes file and the exports you produce are ordinary files on
          your office computer, protected by whatever protects that computer.
        </p>
        <p className="font-semibold text-sand-900">Things that do leave the computer</p>
        <p>
          Two, and only when you ask for them. Exported slates, lists and PDFs are saved to this
          computer and go wherever you then send them — by default they carry case codes rather than
          names. And removing a patient from the waitlist opens an email to the hospital booking
          office containing that patient&apos;s PHN, so the booking office knows who to take off. You
          see and send that email yourself.
        </p>
      </Section>

      <Section title="Tips & troubleshooting">
        <ul className="list-disc pl-5">
          <li>Set a date for every slate — an amber banner warns about missing, duplicate, or past dates.</li>
          <li>Upload one surgeon&apos;s file at a time; a banner warns if it detects several.</li>
          <li>Durations drive how many cases fit — adjust per-case estimates for an accurate slate.</li>
          <li>If the slate looks empty, check the file includes TARGET_TIME and TIME_WAITING.</li>
          <li>
            Don&apos;t reload the page mid-session — the list is held in the tab only, so you would
            need to upload it again. Finish and export first.
          </li>
          <li>
            Loading a notes file takes a second or two: unlocking it is deliberately slow, which is
            what makes the passphrase hard to guess.
          </li>
        </ul>
      </Section>

      <footer className="pb-6 text-center text-xs text-sand-500">Generated with SlateBuilder</footer>
    </main>
  );
}
