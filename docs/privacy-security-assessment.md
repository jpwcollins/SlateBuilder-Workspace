# SlateBuilder for Offices — Privacy & security assessment

_Removed from the in-app user guide on 2026-11-26 and kept here for reference. It reflects the app as of commit b13d121._

A review of how SlateBuilder handles patient information, written from the source code and from testing the running application. It was written so the office can see exactly what the tool does with the data it is given. It is a technical review, not legal advice, and does not replace a formal privacy assessment by a qualified privacy officer.

## A · What the tool is

SlateBuilder is a calculator, not a record system. It has no accounts, no database and no server. The hospital's weekly file remains the only list of who is waiting; the tool reads it, sorts it and prints from it, much as a spreadsheet works on a local machine. Nothing you upload is transmitted anywhere.

Three things can be checked by anyone who wants to verify that:

- **There is no server code.** The application builds to static pages only — no server routes, no interfaces that could receive data.
- **Nothing about a patient is written to the browser.** Browser storage holds only settings: which tab you were last on, your saved default case durations, the "Who is saving" label, a reference to the linked notes file, and a save counter and timestamp the app uses to spot an out-of-date notes file. No names, PHNs or notes.
- **Opening a page contacts no one else.** There are no analytics, no trackers and no outside assets — even the typeface is served by the application itself.

## B · What information the tool handles

| Information | From | Where it can persist |
|---|---|---|
| Patient name | the hospital's file | Memory only; exports if you opt to include names; the name key file |
| Personal Health Number | the hospital's file | Memory; **the notes file**; the removal email |
| Diagnosis / procedure | the hospital's file | Memory only; printed slates |
| Surgeon | the hospital's file | Memory; printed slates |
| Target and waiting time | the hospital's file | Memory only |
| Clinical flags | entered here | Memory; **the notes file** |
| Unavailable dates, case lengths, removals | entered here | Memory; **the notes file** |
| Reason for booking out of order | chosen here from a fixed list | Memory; **the notes file**; exported slates |
| Typed note beside that reason | entered here | Memory; **the notes file**. Never exported |

Each patient is also given a short code — C-001, C-002 and so on — based on their row in the file. Exports use that code rather than the name unless you tick the box to include names. Because the code describes a row and not a person, it is never used to carry notes from one week to the next; that is done by PHN.

## C · Where information goes

**While you work** — the whole waitlist, names and all, sits in the browser tab's memory and nowhere else. Closing the tab clears it.

**If you save notes** — a file on this computer holding PHNs alongside your notes and clinical flags, encrypted with your passphrase. It contains no names, no diagnoses and no copy of the waitlist. It is still a health record and should be kept and deleted like one.

**When you send something out** — exported slates and lists (case codes by default), the name key file (always contains names), and the email to the hospital's booking office when you remove a patient, which contains that patient's PHN so the booking office knows who to take off. All of these are created on this computer and go only where you send them.

## D · What protects it

| Protection | How it works |
|---|---|
| No server | No accounts, no database, no interfaces. Patient information has nowhere to be sent. |
| Nothing kept in the browser | The waitlist and notes are never written to browser storage — only settings such as default durations, the “Who is saving” label and a reference to the linked notes file. |
| No outside connections | No analytics or trackers, and no files loaded from anyone else's website. |
| Encryption of saved notes | AES-256 with authentication, and a key stretched from your passphrase in a deliberately slow way so guessing is expensive. A tampered file is refused rather than silently accepted. |
| Passphrase strength | Checked when a notes file is created: at least 12 characters, and easily guessed passphrases (a common word with numbers added, keyboard runs, repetition) are refused. 4 or 5 random words joined by hyphens are recommended; generated passwords from Apple or Chrome are also accepted. There is no recovery: nobody can open the file without it. |
| Passphrase handling | Entered once per file, when it is created or opened. The derived key is held in memory, non-extractable, for as long as that file is open; the passphrase itself is discarded after use and neither is ever written to the device. Cleared by Clear screen, by unlinking, and by closing the tab. |
| Only notes are saved | Names, diagnoses and the waitlist itself are left out, and notes for patients no longer waiting are discarded when you load. |
| Notes follow the patient, not the row | Matching is by PHN, so one patient's notes can never attach to whoever happens to occupy their old row next week. |
| Exports minimised | Case codes by default; including names is a deliberate action each session. The booking-order mark on a slate carries a reason from a fixed list only — the typed note beside it is never printed or exported. |
| Spreadsheet safety | Cells that Excel would treat as live formulas are neutralised in exported files. |

## E · What is still worth attention

Almost none of the points below are faults in the software. They follow from where the design puts the data: removing the server removed a whole class of risk and, with it, the ability to configure anything centrally. Looking after the information now rests with the office, so most of what follows is answered by how the office works rather than by code.

### R-01 · This computer is the whole of the security (High)

Everything that protects patient information day to day now belongs to this machine: whether the disk is encrypted, whether the screen locks, who can sit at the keyboard, and whether it is patched. The tool cannot compensate for any of that.

Worth confirming and writing down: full-disk encryption switched on (BitLocker or FileVault), an automatic screen lock, separate logins if more than one person uses the machine, and who has physical access to the room.

### R-02 · The notes file could be copied to a personal cloud without anyone noticing (High)

Downloads and Documents folders are very often synced to OneDrive, iCloud Drive, Google Drive or Dropbox — frequently switched on by default and then forgotten. If the notes file lands in one, a file containing PHNs and clinical flags is copied to a company nobody chose, and kept under their backup rules. It is encrypted, which limits the damage, but it is still a disclosure.

This is the most likely way for information to leak, precisely because it needs no mistake by anyone. Pick a folder, confirm it does not sync, and record where it is. The same goes for exported slates and the name key file.

### R-03 · The name key file has no protection of its own (Moderate)

Exports use case codes, and the name key file is what turns those codes back into names. It is a plain spreadsheet with every patient name on it. The filename is marked CONFIDENTIAL, but nothing stops it being opened or sent. Emailing it alongside a slate undoes the whole point of using codes.

### R-04 · Removing a patient sends their PHN by email (Moderate)

Taking a patient off the waitlist opens an email to the hospital's booking office with that patient's PHN in it, so they know who to remove. The workflow is legitimate and the recipient is the hospital, but it is the one thing the tool routinely sends out, and it leaves its protection entirely. You see and send the message yourself.

### R-05 · Nothing expires on its own (Moderate)

The notes file and every exported slate, list and name key stay on this computer until somebody deletes them. The tool cannot delete files it has handed to the computer. Decide how long they should be kept, who deletes them, and what happens when the pilot ends.

### R-06 · The passphrase is shared, and cannot be recovered (Moderate)

If more than one person uses the tool they share one passphrase, so the file cannot tell them apart. Keep it in whatever the office already uses for passwords, and save a fresh file under a new passphrase when somebody leaves.

Forgetting it means the notes are gone for good. That is deliberate, and the damage is limited: the notes can be rebuilt over following weeks, and nothing about the patients themselves is lost, because the hospital's list is the real record.

### R-07 · There is no record of who did what (Moderate)

The tool keeps no log of files opened, exports produced or patients removed. It is not the record system — the hospital's booking system is, and that is where such a record properly belongs. Still, it means nobody can reconstruct afterwards what was done here, and that should be an accepted decision rather than a surprise.

### R-08 · A lost computer cannot be wiped remotely (Low)

With no central service there is no way to erase anything if this machine is lost, stolen or thrown out. The encryption and full-disk encryption together make that a small problem, provided the passphrase was not written down next to the file.

### R-09 · The spreadsheet reader comes from its supplier rather than the usual catalogue (Low)

The component that reads Excel files is installed straight from its maker rather than the normal package catalogue, because the catalogue version had unfixed security warnings. It is a reasonable choice, but it means the component sits outside the usual automatic checking — and it is the part that reads patient data.

### R-10 · The passphrase can be guessed at, given the file (Low)

Anyone who obtains a copy of the notes file can try passphrases against it for as long as they like. The design makes each attempt deliberately expensive, but the real protection is the passphrase itself. The app refuses easily guessed passphrases when a file is created and recommends 4 or 5 random words joined by hyphens, which are far stronger — and easier to remember — than a short password with symbols in it. Words chosen at random, not a phrase someone would think of, are what make it strong.

### R-11 · Where the application is served from (Low)

The tool is a set of static pages served by a web host (Vercel), through its worldwide delivery network. Because there is no database and no interface, the host never receives any patient information — not the waitlist, not the notes file. It sends the page and sees only the ordinary details any website sees, such as the office's network address and the time of the visit. Where the host is located therefore has little bearing on patient data, which stays on this computer; it is worth knowing who the host is, and nothing more needs settling.

### R-12 · An unlocked screen can write to the notes file (Low)

So that saving does not demand a passphrase for every edit, the key unlocked by the passphrase is held for as long as the notes file is open, and notes are written to it automatically. Someone who sits down at an unattended, unlocked machine could therefore save to that file.

What limits this is that the same person is already looking at every patient name on the screen, so the exposure is not meaningfully widened by the ability to save. Nothing is written to the device: the key exists only in the page's memory, in a form the browser will not allow any code to read back out, and the passphrase is discarded as soon as it has been used. Clear screen, unlinking the file, and closing the tab each end it. The control is the same one R-01 already asks for — the workstation locking itself.

## F · Questions for the office to settle

1. Which privacy rules govern this — the legislation covering private practice, the College's expectations, and whatever the hospital requires for the data it shares. That decides how long things may be kept and what must happen if information goes astray.
2. What arrangement covers the hospital sending the waitlist here, and whether it allows the office to work on it in a tool of its own choosing.
3. The state of this computer: disk encryption, screen lock, shared or separate logins, physical access. (R-01)
4. Where the notes file will live, and confirmation that the folder does not sync to a personal cloud. (R-02)
5. How long the notes file and exported slates are kept, and who deletes them at the end. (R-05)
6. Whether the absence of an activity log is acceptable, given this is not the record system. (R-07)
7. Whether email is an acceptable way to send a PHN to the booking office. (R-04)
8. What happens if this computer is lost or stolen, and who is told. (R-08)
9. What training staff get on the name key file, the passphrase, and the include-names option. (R-03, R-06)

## G · In summary

SlateBuilder keeps patient information unusually well contained. It holds no database, sends nothing, keeps no account, writes nothing about a patient into the browser, and contacts nobody when a page opens — each of which can be checked rather than taken on trust. Several details go further than is typical: exports default to codes rather than names, exported spreadsheets are made safe against malicious formulas, and notes follow a patient by PHN so they can never attach to the wrong person.

It is not exempt from privacy review. It handles names, PHNs and diagnoses; it produces exports containing patient information; and it saves a file that is plainly a health record. But the claim it can make — **no patient information leaves this computer unless somebody deliberately exports or emails it** — is stronger and easier to demonstrate than most systems of this kind can manage.

The two things worth settling before real patient data is used are the state of this computer (R-01) and where the notes file will live (R-02). Neither needs any change to the software.
