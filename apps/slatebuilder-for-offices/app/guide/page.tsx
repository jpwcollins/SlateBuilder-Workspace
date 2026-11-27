export const metadata = {
  title: "SlateBuilder for Offices — User guide",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-slateBlue-900">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-6 text-sand-800">
        {children}
      </div>
    </section>
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
                <td
                  key={j}
                  className="border-b border-sand-100 px-3 py-2 align-top text-sand-800"
                >
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
        <p className="text-sm uppercase tracking-[0.26em] text-sand-600">
          User guide
        </p>
        <h1 className="text-3xl font-semibold text-slateBlue-900">
          SlateBuilder for Offices
        </h1>
        <p className="text-sm text-sand-700">
          A quick guide to turning your office waitlist into OR slates and
          priority lists. Everything runs in your browser — no patient data
          leaves this computer unless you export it or send the removal email
          yourself. Use Google Chrome or Microsoft Edge.
        </p>
        <a
          href="/"
          className="mt-1 w-fit rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
        >
          ← Back to the app
        </a>
      </header>

      <Section title="1. Load this week's waitlist">
        <p>
          In step 1 on the Setup tab, choose the waitlist file the hospital sent
          — CSV or Excel. Each row is one patient. The importer reads these
          columns:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">PAT_NAME1</span> or{" "}
            <span className="font-semibold">PHN</span> — the patient identifier
            (shown on screen; see privacy below)
          </li>
          <li>
            <span className="font-semibold">SURGEON</span> — used as the surgeon
            shown on printed slates (one surgeon per file)
          </li>
          <li>
            <span className="font-semibold">DIAGNOSIS</span> — the procedure
            (drives the default case duration)
          </li>
          <li>
            <span className="font-semibold">TARGET_TIME</span> and{" "}
            <span className="font-semibold">TIME_WAITING</span> — both in{" "}
            <span className="font-semibold">weeks</span>
          </li>
        </ul>
        <p className="rounded-xl border border-sand-200 bg-white/70 px-4 py-3 text-xs text-sand-700">
          <span className="font-semibold text-sand-900">Privacy:</span> each
          patient is given an opaque code (e.g. C-001). Names stay on your
          screen; exported slates and lists use the code by default. Tick{" "}
          <span className="font-semibold">
            Include patient names in exported CSVs
          </span>{" "}
          only when you need a named list to work from.
        </p>
        <p>
          As soon as the file loads, a summary appears right under it: the
          number of cases, how many are overdue or urgent, and the total
          operative time — a quick check that this is the list you expected.{" "}
          <span className="font-semibold">Show breakdown</span> opens the{" "}
          <span className="font-semibold">Waitlist overview</span>, which splits
          each benchmark class (2w–26w) into well under target, approaching
          target, recently overdue and well overdue, and lists the surgeon IDs
          found in the file.
        </p>
      </Section>

      <Section title="2. Notes file">
        <p>
          Optional. The card shows one step at a time. The first time on a
          computer, choose{" "}
          <span className="font-semibold">Open my notes file</span> if your
          office has kept notes before, or{" "}
          <span className="font-semibold">Start a new notes file</span>: pick
          where it goes, choose a passphrase and{" "}
          <span className="font-semibold">Create notes file</span>. You can do
          this before you have any notes; the file starts empty and fills as
          you work. It is always encrypted on disk. After that the
          card remembers the file, so each week it only asks for the passphrase:{" "}
          <span className="font-semibold">Unlock and load notes</span> brings
          last week&apos;s notes onto this week&apos;s list, matched to whoever
          is still on it. While you work, the card is a single line saying your
          notes are saving themselves. See{" "}
          <span className="font-semibold">Saving your work between weeks</span>{" "}
          below.
        </p>
        <p className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-xs text-rose-900">
          <span className="font-semibold">Use Chrome or Edge.</span> Only they
          can keep one notes file on this computer and save to it automatically.
          In other browsers this step shows a red warning, and every save
          becomes a separate download.
        </p>
      </Section>

      <Section title="3. OR dates">
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">OR dates</span> — choose up to
            three. They default to 3, 5 and 7 weeks from today, so check them
            against your actual OR dates. A standard day is 08:00–16:00 (480
            min); the 2nd and 4th Thursday of the month run 09:00–16:00 (420
            min).
          </li>
          <li>
            <span className="font-semibold">Priority rule</span> — this one
            lives on the{" "}
            <span className="font-semibold">Priority waitlist</span> tab, where
            you can see its effect as you change it. &quot;Urgency first, then
            wait time&quot; is the default; &quot;wait time only&quot; sorts
            purely by time-to-target.
          </li>
          <li>
            <span className="font-semibold">Default case lengths</span> — four
            buckets (hysteroscopy 30, laparoscopy 60, hysterectomy 180, other 90
            min), shown on one line under the dates;{" "}
            <span className="font-semibold">Edit</span> opens them. These are
            starting estimates; you can override any case&apos;s duration on its
            slate card, and most offices will want to.{" "}
            <span className="font-semibold">Save as my defaults</span> remembers
            your own figures in this browser, and the line is marked when they
            differ from the standard ones.
          </li>
          <li>
            When the dates are right,{" "}
            <span className="font-semibold">View suggested slates →</span>,
            right beside the dates, takes you to the slates.
          </li>
        </ul>
        <p>
          A <span className="font-semibold">30-minute turnaround</span> (OR
          prep) is added after every case except the last of the day, and a
          slate holds a{" "}
          <span className="font-semibold">maximum of 7 cases</span>.
        </p>
      </Section>

      <Section title="Review the suggested slates">
        <p>
          For each OR date the tool builds a slate in two steps: it first places
          every patient who is already{" "}
          <span className="font-semibold">past target</span> (most urgent first,
          so the longest-waiting are never bumped), then fills the remaining
          time with not-yet-overdue cases to complete as many further patients
          as possible.
        </p>
        <ul className="list-disc pl-5">
          <li>
            The capacity bar shows time used vs. the block, including
            turnaround.
          </li>
          <li>
            Drag cases to reorder them; the order is the running order for the
            day.
          </li>
          <li>
            Drag a patient onto a slate that is already full and the slate makes
            room: its lowest-priority cases move out, each to the earliest
            unlocked slate it can have. That can be an earlier slate with free
            time, or a later one that moves out one of its own lower-priority
            cases in turn. Anyone who fits nowhere goes back to the waitlist as
            not yet slated. You see the list of moves and
            confirm before anything changes. Locked slates, and patients someone
            placed by hand, are never moved.
          </li>
          <li>
            Edit a case&apos;s duration or clinical flags, or set a date a
            patient is <span className="font-semibold">unavailable until</span>.
            If that date falls on or after a slate the patient is already on,
            they&apos;re automatically pulled off that slate and placed on the
            next later slate that has room (skipping any locked slate); if
            nothing fits, they drop back to the waitlist as not-yet-slated. Use
            the <span className="font-semibold">Clear</span> button next to the
            date to remove the unavailability entirely — this does not
            automatically re-slate the patient.
          </li>
          <li>
            <span className="font-semibold">Remove from suggested slates</span>{" "}
            takes a case off; the freed time is offered to the next patient.
            Restore it from the Priority Waitlist.
          </li>
          <li>
            <span className="font-semibold">Lock slate</span> freezes a
            slate&apos;s composition — patients can&apos;t be added or removed
            (drag is rejected), though durations and flags on existing cases can
            still be edited. Locked slates and their patients are skipped
            entirely by Optimize Utilization below.
          </li>
          <li>
            <span className="font-semibold">Optimize Utilization</span> repacks
            every <span className="font-semibold">unlocked</span> slate to fit
            in as much OR time as possible. Over-target patients are placed
            first, most overdue first, and are never bumped in favor of a
            not-yet-overdue one — though which slate an over-target patient
            lands on can change. A not-yet-overdue patient can still be bumped
            back to the waitlist if a better-fitting mix of cases packs the
            block tighter. The summary that follows lists exactly who was added
            or removed per slate, and separately flags any over-target patient
            who couldn&apos;t be fit into any unlocked slate at all (they return
            to the waitlist as not-yet-slated rather than being silently
            dropped).
          </li>
          <li>
            Export each slate as a one-page{" "}
            <span className="font-semibold">PDF</span> (surgeon and date
            prominent, room for handwritten notes), as a{" "}
            <span className="font-semibold">CSV</span>, or all slates at once.{" "}
            <span className="font-semibold">Export all slates (PDF)</span> is at
            the top of the section.
          </li>
        </ul>
      </Section>

      <Section title="Booking order: was each case booked first-in, first-out?">
        <p>
          Every case on a slate carries a mark showing whether it was booked in
          priority order — the order on the Priority waitlist tab, which within
          one benchmark class is strictly first-in, first-out — and, if not,
          why. The same mark is printed on the slate PDF (top of the notes
          column, with a key at the foot of the page) and written to the slate
          CSV as the <span className="font-semibold">booking_order</span> and{" "}
          <span className="font-semibold">booking_order_reason</span> columns.
        </p>
        <p>
          <span className="font-semibold">
            A mark is about that case and nothing else.
          </span>{" "}
          Something done to one patient never changes the mark on another.
        </p>
        <Rows
          head={["Mark", "What it means"]}
          rows={[
            [
              <span key="f" className="font-semibold text-emerald-800">
                FIFO (green tick)
              </span>,
              "Nobody who ranks ahead of this patient, and who was there to be booked for this date, is still waiting or booked later.",
            ],
            [
              <span key="o" className="font-semibold text-sky-800">
                Optimization (blue clock)
              </span>,
              "Booked ahead of someone higher-ranked, and nobody placed it there by hand: the tool chose this mix of cases to make best use of the OR time. Typically a long case that would not fit was passed by shorter ones.",
            ],
            [
              <span key="c" className="font-semibold text-sky-800">
                Clinical (blue stethoscope)
              </span>,
              "This patient was dragged onto the slate by hand, ahead of someone higher-ranked, and there is a recorded reason — or a clinical flag on them — that accounts for it.",
            ],
            [
              <span key="u" className="font-semibold text-rose-700">
                No reason (red)
              </span>,
              "This patient was dragged onto the slate by hand, ahead of someone higher-ranked, and nothing accounts for it.",
            ],
          ]}
        />
        <p className="font-semibold text-sand-900">Holding a patient back</p>
        <p>
          Taking a patient off the suggested slates, or dragging them to a later
          one, does <span className="font-semibold">not</span> change the marks
          on the cases behind them. Those patients did nothing; they were simply
          next. What it does instead:
        </p>
        <ul className="list-disc pl-5">
          <li>
            The moment you do it, the app asks why. Choose a reason from the
            list, or skip it.
          </li>
          <li>
            If you skip it, the patient is listed in a red panel at the top of
            the Suggested slates tab and tagged{" "}
            <span className="font-semibold">Reason needed</span> on their
            Priority Waitlist row, until a reason is recorded.
          </li>
          <li>
            Until then, each slate where someone lower-ranked is booked in their
            place says so in one line — for example{" "}
            <span className="font-semibold">
              1 higher-ranked patient held back, no reason recorded
            </span>
            . That line is printed on the slate PDF, and the count is in the
            slate CSV&apos;s{" "}
            <span className="font-semibold">slate_held_back_no_reason</span>{" "}
            column.
          </li>
          <li>
            A patient held back without consequence — nobody lower-ranked is
            booked on a date they could have had — needs no reason and is not
            listed.
          </li>
        </ul>
        <p className="font-semibold text-sand-900">
          What counts, and what does not
        </p>
        <ul className="list-disc pl-5">
          <li>
            Passing a patient who is{" "}
            <span className="font-semibold">unavailable</span> on that date is
            not out of order — they could not have been booked. Nor is passing
            someone who has been removed from the waitlist.
          </li>
          <li>
            Only the <span className="font-semibold">date</span> a patient gets
            is judged, not where they sit in the day&apos;s running order.
            Dragging a case up or down within a slate never changes its mark.
          </li>
          <li>
            Patients who rank exactly level are never counted as passing one
            another.
          </li>
          <li>
            Changing the priority rule changes the queue the marks are judged
            against, so the marks can change with it.
          </li>
        </ul>
        <p className="font-semibold text-sand-900">Recording a reason</p>
        <p>
          The app asks for a reason when you drag a patient onto a slate ahead
          of others, hold one back, or drag one to a later slate — but only if
          the move actually puts someone out of order. You can also record or
          change a reason later: in the red panel, on the patient&apos;s slate
          card, or on their row in the Priority Waitlist.
        </p>
        <p>
          The reason comes from a short fixed list. You can add a typed note
          beside it for your own use; the note stays on screen and in your notes
          file and is{" "}
          <span className="font-semibold">never printed or exported</span>. A
          clinical flag (OSA, diabetes, out-of-town and so on) on the patient
          who was moved is accepted as a reason by itself, so a flagged patient
          is never asked about — though a recorded reason, where there is one,
          is what gets shown. A flag does not turn the tool&apos;s own choice
          into a clinical exception: where nobody placed the case by hand, the
          mark stays Optimization.
        </p>
        <p>
          Reasons are saved with your other notes and follow the patient from
          week to week. Which slate a patient was dragged onto is not saved — a
          fresh upload rebuilds the suggested slates from scratch — and{" "}
          <span className="font-semibold">Optimize Utilization</span> clears it
          for every unlocked slate, since after that the placements are the
          tool&apos;s.
        </p>
      </Section>

      <Section title="Work from the Priority Waitlist">
        <p>
          The Priority Waitlist ranks the whole office by composite priority and
          marks each patient <span className="font-semibold">Slated</span> or{" "}
          <span className="font-semibold">Waiting</span>, so staff can work from
          one list. Export it as a PDF or CSV.
        </p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">Remove from waitlist</span> (trash
            icon) takes a patient off the list entirely, off any slate, and
            opens a pre-filled email to booking asking for them to be removed
            from the source system. The row stays visible, greyed out and struck
            through, so the removal is auditable. Click{" "}
            <span className="font-semibold">Restore to waitlist</span> on that
            row to reverse it — the patient reappears as not-yet-slated
            (you&apos;ll need to drag them onto a slate again if needed).
          </li>
          <li>
            A{" "}
            <span className="font-semibold">
              Patients with a period of unavailability
            </span>{" "}
            panel sits at the bottom of the waitlist, listing everyone with an
            unavailable-until date, soonest first, with a one-click{" "}
            <span className="font-semibold">Clear</span>. They remain in the
            main list above too — this panel is just a quick way to see who has
            an upcoming hold.
          </li>
        </ul>
      </Section>

      <Section title="Long-waiters (over target)">
        <p>
          This section lists every patient already past their target, grouped by
          urgency class and most-overdue-first. These are the patients
          guaranteed onto slates before any not-yet-overdue case. Export the
          full list as PDF or CSV to review or circulate.
        </p>
      </Section>

      <Section title="How the priority score works">
        <p>
          Each case scores its benchmark urgency weight (2w = 5, 4w = 4, 6w = 3,
          12w = 2, 26w = 1) multiplied by how far the patient has waited toward
          their target. The score climbs every day and keeps rising once a
          patient is past target, so urgency and waiting time both count — and a
          breached short-target patient outranks a long-overdue long-target one.
        </p>
      </Section>

      <Section title="Saving your work between weeks">
        <p>
          SlateBuilder has{" "}
          <span className="font-semibold">no accounts and no cloud</span>. The
          waitlist you upload is held in the browser tab you are working in and
          nowhere else — not on this computer&apos;s hard drive, and not on any
          server. Closing the tab clears it.
        </p>
        <p>
          What is worth keeping from week to week is not the list (the hospital
          sends a fresh one every time) but{" "}
          <span className="font-semibold">your notes on it</span>: who is away
          until when, which cases you have given a longer slot, the clinical
          flags you have ticked, why someone was booked out of order, and anyone
          you have taken off the list. Those you can save to a file on this
          computer, locked with a passphrase.
        </p>

        <p className="font-semibold text-sand-900">Link one file, once</p>
        <p>
          In step 2, choose{" "}
          <span className="font-semibold">Start a new notes file</span> the
          first time, or{" "}
          <span className="font-semibold">Open my notes file</span> if this
          office has saved notes before. From then on every save replaces that
          one file instead of leaving a new copy in Downloads each week, which
          is what stops an office ending up with several notes files and loading
          the wrong one. Step 2 shows which file you are linked to.
        </p>
        <p>
          Pick a folder your office already uses for confidential documents, and{" "}
          <span className="font-semibold">
            check it is not one that syncs to OneDrive, iCloud or Dropbox
          </span>{" "}
          — those copy files off this computer automatically.
        </p>
        <p>
          <span className="font-semibold">
            This needs Google Chrome or Microsoft Edge
          </span>{" "}
          on a desktop or laptop, with the app opened at its https:// address.
          Safari and Firefox cannot link a file, and no browser can when the app
          is opened over plain http://. In those cases step 2 shows a red
          warning, and every save downloads a new copy instead. The copies pile
          up with only a date to tell them apart, and loading an older one by
          mistake loses the newer notes. Switch browsers if you possibly can; if
          you cannot, keep exactly one notes file and delete older copies after
          every save.
        </p>

        <p className="font-semibold text-sand-900">
          You do not have to remember to save
        </p>
        <p>
          Once a file is linked,{" "}
          <span className="font-semibold">your notes save themselves</span> — a
          couple of seconds after you stop typing, wherever you are in the app.
          There is no trip back to the Setup tab and no passphrase to retype.
          The top bar tells you where things stand from every tab:{" "}
          <span className="font-semibold">Notes saved</span> with the time, or{" "}
          <span className="font-semibold">Unsaved notes</span> with a button if
          anything is still outstanding.
        </p>
        <p>
          <span className="font-semibold">
            The passphrase is asked for once per file.
          </span>{" "}
          You set it when you create the file, and you enter it again only when
          the file is opened afresh — next week, on another computer, or by
          whoever you share it with. While the file is open the app holds the
          key it unlocked rather than the passphrase itself, and it lets go of
          both when you use Clear screen, unlink the file, or close the tab.
        </p>
        <p>
          A browser that cannot link a file cannot save automatically either,
          because each save would drop a fresh copy into Downloads. There,
          saving stays a deliberate click.
        </p>

        <p className="font-semibold text-sand-900">Working with someone else</p>
        <p>
          If the surgeon and the MOA both keep notes, loading a file{" "}
          <span className="font-semibold">combines</span> it with what is
          already on screen rather than replacing it. For each patient the more
          recent note wins, so it does not matter who loads whose file first —
          you end up with both people&apos;s work either way. After loading, the
          message tells you what happened: how many patients now carry notes,
          how many were updated from the file you loaded, and how many of yours
          were kept because they were newer.
        </p>
        <p>
          Put your initials or role in{" "}
          <span className="font-semibold">Who is saving</span> before you save.
          It is recorded in the file so it is clear whose notes are whose.
        </p>

        <p className="font-semibold text-sand-900">
          When the app asks you to confirm
        </p>
        <p>
          Every saved file records when it was written, and that is what the app
          compares. Before loading, it will stop and ask if:
        </p>
        <ul className="list-disc pl-5">
          <li>
            the file was <span className="font-semibold">saved earlier</span>{" "}
            than one already used on this computer, which usually means it is an
            out-of-date copy;
          </li>
          <li>it was last saved more than two weeks ago;</li>
          <li>
            it is dated in the future, which normally means the clock on the
            computer that saved it is wrong — the dates are what decide whose
            note wins when two people have edited the same patient;
          </li>
          <li>
            you have notes on screen that have not been saved, so you know they
            are about to be combined with the file.
          </li>
        </ul>
        <p>
          You can go ahead in each case. The point is that nothing is replaced
          silently.
        </p>
        <p>
          There is one case the app will not let you past: if the linked file
          was last written under a different passphrase, it stops rather than
          saving over it. It cannot read that file, so it cannot merge with it,
          and overwriting would destroy work it never saw. Load the file under
          the right passphrase, or link a different one.
        </p>

        <p className="font-semibold text-sand-900">Things to know</p>
        <ul className="list-disc pl-5">
          <li>
            <span className="font-semibold">
              There is no way to recover a lost passphrase.
            </span>{" "}
            No one — including whoever built this tool — can open the file
            without it. Keep it where your office keeps other confidential
            passwords. If someone leaves, save a fresh file under a new
            passphrase.
          </li>
          <li>
            Notes for patients who are no longer on the hospital&apos;s list are
            left out when you load, so the file never becomes a list of its own.
          </li>
          <li>
            Before walking away from the computer, use{" "}
            <span className="font-semibold">Clear screen</span> in the top bar.
            It removes the uploaded list and every note from the screen. Your
            saved notes file is separate and is not affected.
          </li>
          <li>
            Because nothing is written to the browser,{" "}
            <span className="font-semibold">
              reloading the page loses the list
            </span>{" "}
            and you will need to upload it again. The browser will warn you
            before that happens.
          </li>
        </ul>
      </Section>

      <Section title="Privacy &amp; security, in plain language">
        <p>
          The short version:{" "}
          <span className="font-semibold">
            nothing you upload leaves this computer.
          </span>{" "}
          There is no account to sign in to and no server holding your data. The
          waitlist is read and sorted inside your browser, much as a spreadsheet
          works on your own machine.
        </p>
        <p className="font-semibold text-sand-900">
          What happens to the file the hospital sends
        </p>
        <p>
          When you choose the waitlist file, your browser reads it into memory
          and works on it there. It is not uploaded anywhere. Each patient is
          given a short code — C-001, C-002 and so on — and it is that code, not
          the name, that appears on exported slates and lists unless you
          deliberately tick the box to include names.
        </p>
        <p className="font-semibold text-sand-900">
          What is in the notes file, and what is not
        </p>
        <p>
          The notes file contains each patient&apos;s PHN alongside your notes
          about them: an unavailable date, an adjusted case length, clinical
          flags, whether you removed them, and any reason you recorded for
          booking them out of order — including the optional typed note, which
          is the one place free text is stored, so keep identifying detail out
          of it. The PHN is there because it is what lets a note find the right
          patient in next week&apos;s file. It does{" "}
          <span className="font-semibold">not</span> contain patient names,
          diagnoses, or the waitlist itself.
        </p>
        <p>
          That still makes it a health record, and it should be treated like
          one: keep it wherever your office keeps confidential files, and delete
          it when you no longer need it. It is encrypted with AES-256 — the same
          class of encryption used for online banking — with a key derived from
          your passphrase in a deliberately slow way that makes guessing
          expensive.
        </p>
        <p className="font-semibold text-sand-900">
          Worst case: what if someone got hold of the notes file?
        </p>
        <p>
          Everything rests on the passphrase. Someone who copied the file but
          does not have the passphrase has an unreadable block of ciphertext —
          and even opened, it holds no names and no diagnoses. Someone who has
          both the file and the passphrase can read your notes, including PHNs,
          which is exactly why the passphrase should be a real one. Use 4 or 5
          random words joined by hyphens — something like{" "}
          <span className="font-mono">harbour-velvet-spoon-orbit</span> — which
          is both stronger and easier to remember than a short password with
          symbols in it. The app checks the passphrase when a file is first
          created and will not accept one that is easy to guess, such as a
          single word with numbers added.
        </p>
        <p className="font-semibold text-sand-900">While the file is open</p>
        <p>
          So that you are not asked for the passphrase every time something is
          saved, the app keeps the key your passphrase unlocked for as long as
          the file is open. It keeps the{" "}
          <span className="font-semibold">key</span>, not the passphrase: the
          key is held in a form the browser will not let any code read back out,
          and the passphrase itself is discarded the moment it has been used.
          Nothing is written to this computer — closing the tab ends it, and so
          do Clear screen and unlinking the file.
        </p>
        <p>
          What this means in practice: while SlateBuilder is open on an unlocked
          computer, someone at that keyboard could save to your notes file. They
          could also read every patient name on the screen in front of them,
          which is the larger problem and the reason the same advice applies
          either way — lock the screen, or use Clear screen, before you walk
          away.
        </p>
        <p>
          Because there is no server, there is no database to be breached, no
          account to be taken over, and nothing about your patients stored
          anywhere you cannot see. The trade is that safekeeping moves to you:
          the notes file and the exports you produce are ordinary files on your
          office computer, protected by whatever protects that computer.
        </p>
        <p className="font-semibold text-sand-900">
          Things that do leave the computer
        </p>
        <p>
          Two, and only when you ask for them. Exported slates, lists and PDFs
          are saved to this computer and go wherever you then send them — by
          default they carry case codes rather than names. And removing a
          patient from the waitlist opens an email to the hospital booking
          office containing that patient&apos;s PHN, so the booking office knows
          who to take off. You see and send that email yourself.
        </p>
      </Section>

      <Section title="Tips & troubleshooting">
        <ul className="list-disc pl-5">
          <li>
            Set a date for every slate — an amber banner warns about missing,
            duplicate, or past dates.
          </li>
          <li>
            Upload one surgeon&apos;s file at a time; a banner warns if it
            detects several.
          </li>
          <li>
            Durations drive how many cases fit — adjust per-case estimates for
            an accurate slate.
          </li>
          <li>
            If the slate looks empty, check the file includes TARGET_TIME and
            TIME_WAITING.
          </li>
          <li>
            Don&apos;t reload the page mid-session — the list is held in the tab
            only, so you would need to upload it again. Finish and export first.
          </li>
          <li>
            Loading a notes file takes a second or two: unlocking it is
            deliberately slow, which is what makes the passphrase hard to guess.
          </li>
        </ul>
      </Section>

      <footer className="pb-6 text-center text-xs text-sand-500">
        Generated with SlateBuilder
      </footer>
    </main>
  );
}
