# Ohmest

**Timed online exams that students can take from any device, with built-in integrity checks and instant results.**

Professors build an exam, open it, and watch it live. Students don't need an account: they sign in with their school's code, their name and their student ID.

- **Per-question timers** that the server controls, so a student can't pause the clock
- **Shuffled questions and choices**, plus **different random numbers for every student** on calculation problems
- **Integrity checks**: tab and fullscreen tracking, copy/paste blocking, and a risk flag for each student
- **Formulas shown properly**: stacked fractions, square roots, superscripts, Greek letters
- **Results your way**: score and answer review for students when you decide, Excel download and live Google Sheets for you

---

## Contents

- [For professors](#for-professors)
- [For students](#for-students)
- [Typing formulas and numeric answers](#typing-formulas-and-numeric-answers)
- [Questions and answers (FAQ)](#questions-and-answers-faq)
- [Setting up Ohmest for your school](#setting-up-ohmest-for-your-school)
- [Privacy and good-to-know limits](#privacy-and-good-to-know-limits)

---

## For professors

### 1. Create your account

1. Open your Ohmest site and choose **I'm a professor → Create account**.
2. Starting fresh? Pick **New school** and enter your school's name. Joining colleagues? Pick **Join my school** and enter the faculty code they gave you.
3. Add your name, email and a password (at least 8 characters).

On your dashboard you'll see:

| Code | What it's for |
|---|---|
| **Student code** | Give this to your classes. Students need it to sign in. |
| **Faculty code** | Give this to colleagues so they can join your school. Only the person who created the school sees it. |

Schools can't see each other's data, and professors in the same school only see their own exams.

### 2. Build an exam

Click **New exam**, then add questions on the **Questions** tab.

- **Multiple choice**: type the choices and click the letter next to the right one.
- **Numeric answer**: type the accepted answer (or several, separated by commas) and a tolerance in percent. You can also ask for units.
- **Different numbers per student**: for a numeric question, switch to random numbers, put variables in curly braces in the question (for example `{m}` and `{a}`), set a range for each, and type the answer formula (for example `m*a`). Use **Preview a sample student** to check it.
- **Follow-up question**: attach a short multiple-choice question to a problem. Students who got the problem right may be asked it afterwards.
- **Paste many questions**: paste several multiple-choice questions at once, with a blank line between them. Example:

  ```
  What is the SI unit of force?
  A) Joule
  B) Newton
  C) Watt
  D) Pascal
  Answer: B
  Time: 20
  ```

Use the arrows to reorder questions and the copy icon to duplicate one. Don't forget to press **Save**.

### 3. Choose your settings

Open the **Settings** tab. Every option shows its default, and **Reset to defaults** puts everything back.

| Section | What you can set |
|---|---|
| **When students can take it** | An opening and closing time, or leave both empty and open and close the exam yourself. |
| **Defaults for new questions** | Time, points and tolerance that new questions start with. **Apply to all** pushes them onto existing questions. |
| **Question order** | Shuffle questions and/or answer choices for each student. |
| **Scoring** | Negative marking (a percent of the question's points), unit checking, and whether several accepted answers count. |
| **Anti-cheating** | How many times a student can leave the exam before it locks (0 means never), copy/paste/right-click blocking, and asking for fullscreen. |
| **After the exam** | When students see results, and whether they see their score, a question-by-question review, and the correct answers. |
| **Student tools** | A built-in calculator and formula sheet, plus your own extra formulas or notes. |
| **Integrity checks** | Follow-up questions, and handwritten-work photos (see below). |
| **Class list** | Paste the student IDs allowed to enter. Leave it empty to let anyone from your school in. |
| **Google Sheets** | Send each finished attempt to a spreadsheet (see [Live results in Google Sheets](#live-results-in-google-sheets)). |

New exams start with shuffling, copy blocking and fullscreen on, three allowed departures, and results released when you close the exam. Students see their score and review, but not the correct answers.

### 4. Open the exam

Press **Open to students**. Students sign in at `your-site/student-login` with your student code.

While an exam is open, questions and most settings are locked so nobody is affected mid-exam. You can still change **what students see afterwards** (score, review, correct answers, and when they're released). Close the exam to change anything else.

### 5. Watch it live

On the **Results** tab you can:

- see who is in progress, who finished and who got locked, updating every few seconds
- post an **announcement** that appears on the screen of students taking the exam right now
- **Reset** one student if they have a problem (this wipes that student's attempt so they can start again)

### 6. Review the results

The **Results** tab shows every student's score, how often they left the exam, how long they were away, and an **integrity risk** of Low, Medium or High.

A risk flag is a hint to take a closer look, never proof. It's built from:

- switching tabs or apps, leaving fullscreen, long time away, copy/paste attempts, repeated reloads
- correct answers that came much faster than the class or the time limit suggests
- the same wrong answers as another student (including an answer that fits the *other* student's random numbers)
- getting easy questions wrong but hard ones right (once at least 8 students have finished)
- missing a follow-up question about a problem they answered correctly
- not uploading a requested photo of their handwritten work

Tap a student's name to see details and their activity log. Then mark them **Cleared** or **Needs oral check** so you remember your decision.

**Handwritten work photos.** Under *Integrity checks*, ask students to photograph their written solution for 1 to 3 of their own problems. They get a set number of minutes after finishing to upload. It's a quick way to confirm that a student actually worked out the answers.

**Item analysis** shows which questions the class missed and how long they took.

Click **Download Excel (.xlsx)** for a workbook with results, every answer, flags, item analysis and a full activity log.

### 7. Running the same exam again

Attempts are limited to one per student ID. For a new class or sitting:

1. Close the exam.
2. **Download Excel** so you keep the old results.
3. Click **Clear all attempts** on the Results tab.
4. Open the exam again.

You can't change the questions while students have attempts. Clear the attempts first (changing settings is always fine).

### Live results in Google Sheets

Optional. Each finished attempt is added to a Google Sheet automatically.

1. Create a Google Sheet and choose **Extensions → Apps Script**.
2. Paste in the contents of `google-apps-script/Code.gs`.
3. **Change the `KEY` at the top to a password you invent.** Don't keep the one in the file.
4. Choose **Deploy → New deployment → Web app**. Set *Execute as: Me* and *Who has access: Anyone*. Copy the link that ends in `/exec`.
5. In Ohmest, open your exam's **Settings → Google Sheets**. Paste the link and the same key, click **Test connection**, then **Save**.

Use **Send all results now** to push everything that's already finished.

---

## For students

### Getting in

1. Open the link your professor gave you, or go to `your-site/student-login`.
2. Enter the **school code**, your **full name** and your **student ID**.
3. Pick your exam from the list and press **Start exam**.

### What to expect

- Every question has its **own timer**. When it runs out, your answer locks automatically. If you haven't picked anything, it counts as unanswered.
- You **can't go back** to earlier questions.
- **Stay on the exam screen.** Switching tabs or apps, or leaving fullscreen, is recorded and shown to your professor. If you leave too many times, the exam locks.
- **Reloading the page counts as leaving.** Avoid it unless you have to.
- Copying, pasting and right-clicking may be turned off.
- Your professor may show a built-in **calculator and formula sheet**.
- After you finish, you might get a couple of **follow-up questions** about your own problems, or be asked to **upload a photo of your handwritten work** within a few minutes. Keep scratch paper and your camera handy.
- If a question looks wrong, tap **Report unclear question**.

### Typing numeric answers

You can type `3.5`, `1/4`, `3x10^8`, `3e8`, `2pi` or `sqrt(2)`. A "Reads as…" line shows you how fractions and powers were understood.

> **Heads up:** a comma is read as a decimal point, so `3,5` means 3.5. Type 1500, not 1,500.

### Your receipt and results

When you finish, you get a **receipt code** that looks like `1A2B3C4D-XY12`. Copy it or take a screenshot.

- Your professor decides when results appear. Often it's after the exam is closed for everyone.
- Open **View results** on your exam list to see your score and review, and to print or save it as a PDF.
- If you switched browsers or devices, use **Find my results** at the bottom of the exam list. Enter your student ID and the receipt code.

---

## Typing formulas and numeric answers

### In question text

Type formulas the easy way. Students see them typeset.

| You type | Students see |
|---|---|
| `x=y/z` | x equals y over z, as a stacked fraction |
| `v^2`, `a_1`, `v_0^2` | v², a₁, v₀² |
| `sqrt(a+b)` | a real square root of (a + b) |
| `theta`, `pi`, `omega`, `Delta` | θ, π, ω, Δ |
| `$E = 1/2 m v^2$` | anything between dollar signs is always typeset |

Plain text like "and/or" or "km/h" is left alone. When you want to be sure, use dollar signs.

### In answer formulas (random-number questions)

Answer formulas are forgiving: `0.5*a*t^2`, `0.5at^2`, `F = m a`, `2(x+1)`, `sqrt(2gh)`, `×`, `÷`, `²` and `π` all work.

- Available functions: `sqrt`, `abs`, `ln`, `log` (base 10), `exp`, `min`, `max`, `pow`, `floor`, `ceil`, `round`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`.
- **Angles are in degrees.** For radians, use `sinr`, `cosr`, `tanr`.
- Variable names can be up to 10 characters (letters, digits and underscores, starting with a letter). Don't use `e`, `pi`, `ans` or a function name. You can have up to 6 variables.
- Ohmest checks the formula against 100 random sets of numbers when you save, and warns you if any of them would divide by zero.

---

## Questions and answers (FAQ)

**A student says the exam is locked.**
They left the exam more times than you allowed. Check their activity log. If it was a genuine accident, use **Reset** on their row so they can start again. They'll get a fresh random order and fresh numbers.

**A student sees "This ID already started the exam on another device."**
Ohmest remembers each attempt in the browser it started in. If they switched browsers or cleared their data mid-exam, use **Reset** for that student.

**A student sees "This ID has already submitted the exam."**
Either they really did, or the exam still has attempts from an earlier sitting. See [Running the same exam again](#7-running-the-same-exam-again).

**A student sees "Your ID is not on the class list."**
You've set a class list and their ID isn't in it. Check for typos (capital letters and spaces don't matter). Add the ID in Settings, close and reopen if needed.

**A student lost their receipt code.**
You can find it in your Results tab (the **Receipt** column in the Excel download). Students can then use **Find my results**.

**I forgot my password.**
There's no "forgot password" option yet. Ask whoever set up your Ohmest site.

**Can students cheat with a second device?**
Ohmest can't see a second phone on the desk. It makes cheating harder and helps you spot patterns: shuffled questions, random numbers per student, answer-speed checks, similar wrong answers, follow-ups and work photos. Use the risk flags to decide who to talk to.

---

## Setting up Ohmest for your school

*This part is for whoever puts Ohmest online (one person per school). It takes about 10 minutes and needs no programming. You need three free accounts: **GitHub**, **Vercel** and **Upstash**.*

### 1. Put the files on GitHub

1. Go to <https://github.com/new>. Name the repository `ohmest`, keep it **Private**, and click **Create repository**.
2. Unzip the project. On the new repository page, click **uploading an existing file**, drag in **everything inside the `Ohmest-main` folder** (`api`, `public`, `google-apps-script`, `package.json`, `vercel.json` and `README.md`), and click **Commit changes**.
   - `package.json` and `vercel.json` must be at the **top level** of the repository, not inside another folder.

### 2. Create the database (Upstash)

1. Go to <https://console.upstash.com>, sign up, and click **Create Database**.
2. Name it `ohmest`, pick the region closest to your students, choose **Regional**, and click **Create**.
3. Scroll to the **REST API** section and keep that tab open. You'll copy two values from it in a moment.

### 3. Put it online (Vercel)

1. Go to <https://vercel.com/new>, sign in with GitHub and **Import** your `ohmest` repository.
2. Leave **Framework Preset** as *Other* and leave the build settings empty.
3. Open **Environment Variables** and add these three (spell the names exactly):

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | A long random password of 32+ characters that only you know. A password generator works, or run `openssl rand -base64 48`. If you ever change it, every professor is signed out. |
   | `UPSTASH_REDIS_REST_URL` | The URL from Upstash's REST API section |
   | `UPSTASH_REDIS_REST_TOKEN` | The token from Upstash's REST API section |

   *Shortcut:* instead of pasting the two Upstash values, add the **Upstash Redis** integration from the Vercel Marketplace (Project → Storage). Ohmest understands the values it sets. You still add `AUTH_SECRET` yourself.
4. Click **Deploy**. When it finishes you'll get a link like `https://ohmest-yourname.vercel.app`.

> If you add or change an environment variable **after** the first deploy, go to Deployments → ⋯ → **Redeploy**. Variables only apply to new deployments.

### 4. First run

Open your link and follow [For professors](#for-professors) to create the first account. You're live.

### Your own web address (optional)

In Vercel, open your project → **Settings → Domains**, add the domain and follow the instructions. HTTPS is automatic.

### Updating later

Edit a file on GitHub (or upload a new version) and commit. Vercel redeploys on its own in about a minute. Your data lives in Upstash, so updates never touch it.

### If something goes wrong

| What you see | What to do |
|---|---|
| "Database not connected" | The two Upstash values are missing or misspelled. Fix them in Vercel, then **Redeploy**. |
| "AUTH_SECRET is not set on the server" | Add `AUTH_SECRET` in Vercel, then **Redeploy**. |
| Professors keep getting signed out | `AUTH_SECRET` changed between deploys, or the browser is blocking site storage. |
| "Page not found" on `/student-login` | `vercel.json` isn't at the top level of the repository. Move it there. |
| The page loads but nothing works | Press F12, open the **Network** tab and click the `/api` request. Its error message says what's missing. |
| "Too many attempts" | A built-in limit on sign-ins and codes. Wait a few minutes. |
| Icons appear as words, or Excel download does nothing | The page couldn't load fonts or the Excel library from the internet. Check the connection and refresh. |

### For developers: run it on your computer

```
npm i -g vercel
npm install
vercel dev
```

Before running, create a file named `.env.local` in the project folder containing the same three values as above:

```
AUTH_SECRET=your-long-random-string
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

There's no build step: the site is plain HTML in `public/`, with one serverless function in `api/index.js` and a Redis database.

---

## Privacy and good-to-know limits

**Where your data lives.** Everything is stored in your own Upstash database. Students are identified only by the name and ID they type. Professors' passwords are salted and hashed. Handwritten-work photos are stored in the database and deleted when you reset a student, clear attempts or delete the exam. If you use Google Sheets, a copy of the results (names, IDs, scores, flags) also lives in your sheet.

**Outside services.** The pages load fonts from Google Fonts and the Excel export library from a public CDN (cdnjs).

**Good to know**

- Student IDs aren't verified. Anyone who has your school code could type any ID. Use a **Class list**, and keep an eye on the Results tab.
- One attempt per student ID, and an attempt belongs to the browser it started in.
- Questions are multiple choice or numeric. There's no partial credit, and no pictures in questions yet.
- There's no password reset yet.