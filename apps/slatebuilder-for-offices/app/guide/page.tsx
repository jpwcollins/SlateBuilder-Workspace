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

const severityClasses: Record<string, string> = {
  High: "bg-rose-100 text-rose-700",
  Moderate: "bg-amber-100 text-amber-800",
  Low: "bg-sand-200 text-sand-700",
};

function Severity({ level }: { level: "High" | "Moderate" | "Low" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${severityClasses[level]}`}
    >
      {level}
    </span>
  );
}

function Risk({
  id,
  title,
  level,
  children,
}: {
  id: string;
  title: string;
  level: "High" | "Moderate" | "Low";
  children: React.ReactNode;
}) {
  const bar =
    level === "High" ? "border-l-rose-400" : level === "Moderate" ? "border-l-amber-400" : "border-l-sand-300";
  return (
    <div className={`rounded-xl border border-sand-200 border-l-4 ${bar} bg-white/70 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-sand-500">{id}</span>
        <span className="font-semibold text-sand-900">{title}</span>
        <Severity level={level} />
      </div>
      <div className="mt-2 flex flex-col gap-2 text-sm leading-6 text-sand-800">{children}</div>
    </div>
  );
}

function Rows({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-sand-200">
      <table className="w-full border-collapse bg-white/70 text-left text-xs">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-sand-200 bg-sand-50 px-3 py-2 font-semibold uppercase tracking-wider text-sand-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border-b border-sand-100 px-3 py-2 align-top text-sand-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          anyone you have taken off the list. Those you can save to a file on this computer, locked
          with a passphrase.
        </p>

        <p className="font-semibold text-sand-900">Link one file, once</p>
        <p>
          In step 2, choose <span className="font-semibold">Create a new notes file</span> the first
          time, or <span className="font-semibold">use one you already have</span> if this office has
          saved notes before. From then on every save replaces that one file instead of leaving a new
          copy in Downloads each week, which is what stops an office ending up with several notes
          files and loading the wrong one. Step 2 shows which file you are linked to.
        </p>
        <p>
          Pick a folder your office already uses for confidential documents, and{" "}
          <span className="font-semibold">check it is not one that syncs to OneDrive, iCloud or
          Dropbox</span> — those copy files off this computer automatically.
        </p>
        <p>
          Not every browser can do this. Chrome and Edge can; Safari and Firefox cannot, and neither
          can any browser when the app is opened over an insecure address. If yours cannot, the app
          says so and saves a downloaded copy instead — in that case keep only the newest file and
          delete the rest.
        </p>

        <p className="font-semibold text-sand-900">You do not have to remember to save</p>
        <p>
          Once a file is linked, <span className="font-semibold">your notes save themselves</span> — a
          couple of seconds after you stop typing, wherever you are in the app. There is no trip back
          to the Setup tab and no passphrase to retype. The top bar tells you where things stand from
          every tab: <span className="font-semibold">Notes saved</span> with the time, or{" "}
          <span className="font-semibold">Unsaved notes</span> with a button if anything is still
          outstanding.
        </p>
        <p>
          <span className="font-semibold">The passphrase is asked for once per file.</span> You set it
          when you create the file, and you enter it again only when the file is opened afresh — next
          week, on another computer, or by whoever you share it with. While the file is open the app
          holds the key it unlocked rather than the passphrase itself, and it lets go of both when you
          use Clear screen, unlink the file, or close the tab.
        </p>
        <p>
          A browser that cannot link a file cannot save automatically either, because each save would
          drop a fresh copy into Downloads. There, saving stays a deliberate click.
        </p>

        <p className="font-semibold text-sand-900">Working with someone else</p>
        <p>
          If the surgeon and the MOA both keep notes, loading a file{" "}
          <span className="font-semibold">combines</span> it with what is already on screen rather
          than replacing it. For each patient the more recent note wins, so it does not matter who
          loads whose file first — you end up with both people&apos;s work either way. After loading,
          the message tells you what happened: how many patients now carry notes, how many were
          updated from the file you loaded, and how many of yours were kept because they were newer.
        </p>
        <p>
          Put your initials or role in <span className="font-semibold">Who is saving</span> before you
          save. It is recorded in the file so it is clear whose notes are whose.
        </p>

        <p className="font-semibold text-sand-900">When the app asks you to confirm</p>
        <p>
          Every saved file records when it was written, and that is what the app compares. Before
          loading, it will stop and ask if:
        </p>
        <ul className="list-disc pl-5">
          <li>
            the file was <span className="font-semibold">saved earlier</span> than one already used on
            this computer, which usually means it is an out-of-date copy;
          </li>
          <li>it was last saved more than two weeks ago;</li>
          <li>
            it is dated in the future, which normally means the clock on the computer that saved it is
            wrong — the dates are what decide whose note wins when two people have edited the same
            patient;
          </li>
          <li>
            you have notes on screen that have not been saved, so you know they are about to be
            combined with the file.
          </li>
        </ul>
        <p>
          You can go ahead in each case. The point is that nothing is replaced silently.
        </p>
        <p>
          There is one case the app will not let you past: if the linked file was last written under a
          different passphrase, it stops rather than saving over it. It cannot read that file, so it
          cannot merge with it, and overwriting would destroy work it never saw. Load the file under
          the right passphrase, or link a different one.
        </p>

        <p className="font-semibold text-sand-900">Things to know</p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">There is no way to recover a lost passphrase.</span> No
            one — including whoever built this tool — can open the file without it. Keep it where your
            office keeps other confidential passwords. If someone leaves, save a fresh file under a new
            passphrase.
          </li>
          <li>
            Notes for patients who are no longer on the hospital&apos;s list are left out when you
            load, so the file never becomes a list of its own.
          </li>
          <li>
            Before walking away from the computer, use{" "}
            <span className="font-semibold">Clear screen</span> in the top bar. It removes the uploaded
            list and every note from the screen. Your saved notes file is separate and is not affected.
          </li>
          <li>
            Because nothing is written to the browser,{" "}
            <span className="font-semibold">reloading the page loses the list</span> and you will need
            to upload it again. The browser will warn you before that happens.
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
        <p className="font-semibold text-sand-900">While the file is open</p>
        <p>
          So that you are not asked for the passphrase every time something is saved, the app keeps
          the key your passphrase unlocked for as long as the file is open. It keeps the{" "}
          <span className="font-semibold">key</span>, not the passphrase: the key is held in a form
          the browser will not let any code read back out, and the passphrase itself is discarded the
          moment it has been used. Nothing is written to this computer — closing the tab ends it, and
          so do Clear screen and unlinking the file.
        </p>
        <p>
          What this means in practice: while SlateBuilder is open on an unlocked computer, someone at
          that keyboard could save to your notes file. They could also read every patient name on the
          screen in front of them, which is the larger problem and the reason the same advice applies
          either way — lock the screen, or use Clear screen, before you walk away.
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

      <div className="mt-4 border-t-2 border-sand-300 pt-6">
        <p className="text-sm uppercase tracking-[0.26em] text-sand-600">Appendix</p>
        <h2 className="mt-1 text-2xl font-semibold text-slateBlue-900">
          Privacy &amp; security assessment
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-sand-700">
          A review of how SlateBuilder handles patient information, written from the source code and
          from testing the running application. It is included here so the office can see exactly what
          the tool does with the data it is given. It is a technical review, not legal advice, and does
          not replace a formal privacy assessment by a qualified privacy officer.
        </p>
      </div>

      <Section title="A · What the tool is">
        <p>
          SlateBuilder is a calculator, not a record system. It has no accounts, no database and no
          server. The hospital&apos;s weekly file remains the only list of who is waiting; the tool
          reads it, sorts it and prints from it, much as a spreadsheet works on a local machine.
          Nothing you upload is transmitted anywhere.
        </p>
        <p>Three things can be checked by anyone who wants to verify that:</p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">There is no server code.</span> The application builds to
            static pages only — no server routes, no interfaces that could receive data.
          </li>
          <li>
            <span className="font-semibold">Nothing about a patient is written to the browser.</span>{" "}
            After loading a waitlist, browser storage holds only a note of which tab you were last on.
          </li>
          <li>
            <span className="font-semibold">Opening a page contacts no one else.</span> There are no
            analytics, no trackers and no outside assets — even the typeface is served by the
            application itself.
          </li>
        </ul>
      </Section>

      <Section title="B · What information the tool handles">
        <Rows
          head={["Information", "From", "Where it can persist"]}
          rows={[
            ["Patient name", "the hospital's file", "Memory only; exports if you opt to include names; the name key file"],
            ["Personal Health Number", "the hospital's file", <span key="phn">Memory; <span className="font-semibold">the notes file</span>; the removal email</span>],
            ["Diagnosis / procedure", "the hospital's file", "Memory only; printed slates"],
            ["Surgeon", "the hospital's file", "Memory; printed slates"],
            ["Target and waiting time", "the hospital's file", "Memory only"],
            ["Clinical flags", "entered here", <span key="f">Memory; <span className="font-semibold">the notes file</span></span>],
            ["Unavailable dates, case lengths, removals", "entered here", <span key="n">Memory; <span className="font-semibold">the notes file</span></span>],
          ]}
        />
        <p>
          Each patient is also given a short code — C-001, C-002 and so on — based on their row in the
          file. Exports use that code rather than the name unless you tick the box to include names.
          Because the code describes a row and not a person, it is never used to carry notes from one
          week to the next; that is done by PHN.
        </p>
      </Section>

      <Section title="C · Where information goes">
        <p>
          <span className="font-semibold">While you work</span> — the whole waitlist, names and all,
          sits in the browser tab&apos;s memory and nowhere else. Closing the tab clears it.
        </p>
        <p>
          <span className="font-semibold">If you save notes</span> — a file on this computer holding
          PHNs alongside your notes and clinical flags, encrypted with your passphrase. It contains no
          names, no diagnoses and no copy of the waitlist. It is still a health record and should be
          kept and deleted like one.
        </p>
        <p>
          <span className="font-semibold">When you send something out</span> — exported slates and
          lists (case codes by default), the name key file (always contains names), and the email to
          the hospital&apos;s booking office when you remove a patient, which contains that
          patient&apos;s PHN so the booking office knows who to take off. All of these are created on
          this computer and go only where you send them.
        </p>
      </Section>

      <Section title="D · What protects it">
        <Rows
          head={["Protection", "How it works"]}
          rows={[
            ["No server", "No accounts, no database, no interfaces. Patient information has nowhere to be sent."],
            ["Nothing kept in the browser", "The waitlist is never written to browser storage — only a note of which tab you were on."],
            ["No outside connections", "No analytics or trackers, and no files loaded from anyone else's website."],
            ["Encryption of saved notes", "AES-256 with authentication, and a key stretched from your passphrase in a deliberately slow way so guessing is expensive. A tampered file is refused rather than silently accepted."],
            ["Passphrase floor", "At least 12 characters, with several words recommended. There is no recovery: nobody can open the file without it."],
            ["Passphrase handling", "Entered once per file, when it is created or opened. The derived key is held in memory, non-extractable, for as long as that file is open; the passphrase itself is discarded after use and neither is ever written to the device. Cleared by Clear screen, by unlinking, and by closing the tab."],
            ["Only notes are saved", "Names, diagnoses and the waitlist itself are left out, and notes for patients no longer waiting are discarded when you load."],
            ["Notes follow the patient, not the row", "Matching is by PHN, so one patient's notes can never attach to whoever happens to occupy their old row next week."],
            ["Exports minimised", "Case codes by default; including names is a deliberate action each session."],
            ["Spreadsheet safety", "Cells that Excel would treat as live formulas are neutralised in exported files."],
          ]}
        />
      </Section>

      <Section title="E · What is still worth attention">
        <p>
          Almost none of the points below are faults in the software. They follow from where the
          design puts the data: removing the server removed a whole class of risk and, with it, the
          ability to configure anything centrally. Looking after the information now rests with the
          office, so most of what follows is answered by how the office works rather than by code.
        </p>

        <Risk id="R-01" title="This computer is the whole of the security" level="High">
          <p>
            Everything that protects patient information day to day now belongs to this machine:
            whether the disk is encrypted, whether the screen locks, who can sit at the keyboard, and
            whether it is patched. The tool cannot compensate for any of that.
          </p>
          <p>
            Worth confirming and writing down: full-disk encryption switched on (BitLocker or
            FileVault), an automatic screen lock, separate logins if more than one person uses the
            machine, and who has physical access to the room.
          </p>
        </Risk>

        <Risk id="R-02" title="The notes file could be copied to a personal cloud without anyone noticing" level="High">
          <p>
            Downloads and Documents folders are very often synced to OneDrive, iCloud Drive, Google
            Drive or Dropbox — frequently switched on by default and then forgotten. If the notes file
            lands in one, a file containing PHNs and clinical flags is copied to a company nobody
            chose, and kept under their backup rules. It is encrypted, which limits the damage, but it
            is still a disclosure.
          </p>
          <p>
            This is the most likely way for information to leak, precisely because it needs no mistake
            by anyone. Pick a folder, confirm it does not sync, and record where it is. The same goes
            for exported slates and the name key file.
          </p>
        </Risk>

        <Risk id="R-03" title="The name key file has no protection of its own" level="Moderate">
          <p>
            Exports use case codes, and the name key file is what turns those codes back into names.
            It is a plain spreadsheet with every patient name on it. The filename is marked
            CONFIDENTIAL, but nothing stops it being opened or sent. Emailing it alongside a slate
            undoes the whole point of using codes.
          </p>
        </Risk>

        <Risk id="R-04" title="Removing a patient sends their PHN by email" level="Moderate">
          <p>
            Taking a patient off the waitlist opens an email to the hospital&apos;s booking office with
            that patient&apos;s PHN in it, so they know who to remove. The workflow is legitimate and
            the recipient is the hospital, but it is the one thing the tool routinely sends out, and it
            leaves its protection entirely. You see and send the message yourself.
          </p>
        </Risk>

        <Risk id="R-05" title="Nothing expires on its own" level="Moderate">
          <p>
            The notes file and every exported slate, list and name key stay on this computer until
            somebody deletes them. The tool cannot delete files it has handed to the computer. Decide
            how long they should be kept, who deletes them, and what happens when the pilot ends.
          </p>
        </Risk>

        <Risk id="R-06" title="The passphrase is shared, and cannot be recovered" level="Moderate">
          <p>
            If more than one person uses the tool they share one passphrase, so the file cannot tell
            them apart. Keep it in whatever the office already uses for passwords, and save a fresh
            file under a new passphrase when somebody leaves.
          </p>
          <p>
            Forgetting it means the notes are gone for good. That is deliberate, and the damage is
            limited: the notes can be rebuilt over following weeks, and nothing about the patients
            themselves is lost, because the hospital&apos;s list is the real record.
          </p>
        </Risk>

        <Risk id="R-07" title="There is no record of who did what" level="Moderate">
          <p>
            The tool keeps no log of files opened, exports produced or patients removed. It is not the
            record system — the hospital&apos;s booking system is, and that is where such a record
            properly belongs. Still, it means nobody can reconstruct afterwards what was done here, and
            that should be an accepted decision rather than a surprise.
          </p>
        </Risk>

        <Risk id="R-08" title="A lost computer cannot be wiped remotely" level="Low">
          <p>
            With no central service there is no way to erase anything if this machine is lost, stolen
            or thrown out. The encryption and full-disk encryption together make that a small problem,
            provided the passphrase was not written down next to the file.
          </p>
        </Risk>

        <Risk id="R-09" title="The spreadsheet reader comes from its supplier rather than the usual catalogue" level="Low">
          <p>
            The component that reads Excel files is installed straight from its maker rather than the
            normal package catalogue, because the catalogue version had unfixed security warnings. It
            is a reasonable choice, but it means the component sits outside the usual automatic
            checking — and it is the part that reads patient data.
          </p>
        </Risk>

        <Risk id="R-10" title="The passphrase can be guessed at, given the file" level="Low">
          <p>
            Anyone who obtains a copy of the notes file can try passphrases against it for as long as
            they like. The design makes each attempt deliberately expensive, but the real protection is
            the passphrase itself. Several unrelated words are far stronger — and easier to remember —
            than a short password with symbols in it.
          </p>
        </Risk>

        <Risk id="R-12" title="An unlocked screen can write to the notes file" level="Low">
          <p>
            So that saving does not demand a passphrase for every edit, the key unlocked by the
            passphrase is held for as long as the notes file is open, and notes are written to it
            automatically. Someone who sits down at an unattended, unlocked machine could therefore
            save to that file.
          </p>
          <p>
            What limits this is that the same person is already looking at every patient name on the
            screen, so the exposure is not meaningfully widened by the ability to save. Nothing is
            written to the device: the key exists only in the page&apos;s memory, in a form the
            browser will not allow any code to read back out, and the passphrase is discarded as soon
            as it has been used. Clear screen, unlinking the file, and closing the tab each end it.
            The control is the same one R-01 already asks for — the workstation locking itself.
          </p>
        </Risk>

        <Risk id="R-11" title="Where the application is served from" level="Low">
          <p>
            The tool is served from a web host. Because there is no database and no interface, that
            host never receives any patient information; it sends the page and sees only the ordinary
            details any website sees, such as the office&apos;s network address. Hosting it in Canada
            is still worth doing: it is now the only outside party involved at all, so it allows the
            simple statement that everything leaving the office goes to one named Canadian server.
          </p>
        </Risk>
      </Section>

      <Section title="F · Questions for the office to settle">
        <ol className="list-decimal pl-5">
          <li>
            Which privacy rules govern this — the legislation covering private practice, the College&apos;s
            expectations, and whatever the hospital requires for the data it shares. That decides how
            long things may be kept and what must happen if information goes astray.
          </li>
          <li>
            What arrangement covers the hospital sending the waitlist here, and whether it allows the
            office to work on it in a tool of its own choosing.
          </li>
          <li>The state of this computer: disk encryption, screen lock, shared or separate logins, physical access. (R-01)</li>
          <li>Where the notes file will live, and confirmation that the folder does not sync to a personal cloud. (R-02)</li>
          <li>How long the notes file and exported slates are kept, and who deletes them at the end. (R-05)</li>
          <li>Whether the absence of an activity log is acceptable, given this is not the record system. (R-07)</li>
          <li>Whether email is an acceptable way to send a PHN to the booking office. (R-04)</li>
          <li>What happens if this computer is lost or stolen, and who is told. (R-08)</li>
          <li>What training staff get on the name key file, the passphrase, and the include-names option. (R-03, R-06)</li>
        </ol>
      </Section>

      <Section title="G · In summary">
        <p>
          SlateBuilder keeps patient information unusually well contained. It holds no database, sends
          nothing, keeps no account, writes nothing about a patient into the browser, and contacts
          nobody when a page opens — each of which can be checked rather than taken on trust. Several
          details go further than is typical: exports default to codes rather than names, exported
          spreadsheets are made safe against malicious formulas, and notes follow a patient by PHN so
          they can never attach to the wrong person.
        </p>
        <p>
          It is not exempt from privacy review. It handles names, PHNs and diagnoses; it produces
          exports containing patient information; and it saves a file that is plainly a health record.
          But the claim it can make — <span className="font-semibold">no patient information leaves
          this computer unless somebody deliberately exports or emails it</span> — is stronger and
          easier to demonstrate than most systems of this kind can manage.
        </p>
        <p>
          The two things worth settling before real patient data is used are the state of this computer
          (R-01) and where the notes file will live (R-02). Neither needs any change to the software.
        </p>
      </Section>

      <footer className="pb-6 text-center text-xs text-sand-500">Generated with SlateBuilder</footer>
    </main>
  );
}
