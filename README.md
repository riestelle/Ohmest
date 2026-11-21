# Ohmest

Online exams with per-question timers, anti-cheating checks and instant results. Professors build exams and review results. Students need no account: they sign in with their school's code, their name and their student ID.

No build step. It is plain HTML + one serverless function (`api/index.js`) + a free Redis database. Deploying takes about 10 minutes.

---

## Deploy (step by step)

You need three free accounts: **GitHub**, **Vercel** and **Upstash**. You do not need to install anything.

### 1. Put the code on GitHub

1. Go to <https://github.com/new>, name the repository `ohmest`, keep it **Private**, click **Create repository**.
2. Unzip this project. On the new repository page click **uploading an existing file**, drag in **everything inside the `Ohmest-main` folder** (`api`, `public`, `google-apps-script`, `package.json`, `vercel.json`, `README.md`, `.gitignore`, `.env.example`), and click **Commit changes**.
   - `package.json` and `vercel.json` must sit at the **top level** of the repository, not inside a sub-folder.

### 2. Create the database (Upstash Redis)

1. Go to <https://console.upstash.com>, sign up, click **Create Database**.
2. Name it `ohmest`, pick the region closest to your students, choose **Regional**, and click **Create**.
3. On the database page scroll to the **REST API** section. Keep this tab open: you need `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in step 3.

### 3. Deploy on Vercel

1. Go to <https://vercel.com/new>, sign in with GitHub and **Import** your `ohmest` repository.
2. Leave **Framework Preset** as *Other* and leave the build settings empty. `vercel.json` already tells Vercel to serve the `public` folder.
3. Open **Environment Variables** and add these three (names are exact):

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | A long random string, 32+ characters. Run `openssl rand -base64 48`, or mash your keyboard for 40 characters. Keep it private. If you change it later, every professor is signed out. |
   | `UPSTASH_REDIS_REST_URL` | The URL from the Upstash REST API section |
   | `UPSTASH_REDIS_REST_TOKEN` | The token from the Upstash REST API section |

   *Shortcut:* instead of pasting the two Upstash values you can add the **Upstash Redis** integration from the Vercel Marketplace (Project → Storage). It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which Ohmest also understands. You still add `AUTH_SECRET` yourself.
4. Click **Deploy**. When it finishes you get a link like `https://ohmest-yourname.vercel.app`.

> If you add or change an environment variable **after** the first deploy, go to Deployments → ⋯ → **Redeploy**. Variables only apply to new deployments.

### 4. First run

1. Open your link and click **I'm a professor → Create account**.
2. Pick **New school**, enter your school's name, your name, email and a password (8+ characters).
3. On the dashboard you now have two codes:
   - **Student code**: give it to your classes.
   - **Faculty code**: give it to colleagues so they can create accounts under the same school. Schools cannot see each other's data.
4. Click **New exam**, add questions, press **Open to students**.
5. Students go to `your-link/student-login`, type the student code, their name and their ID.

### 5. Optional: your own domain

Vercel → your project → **Settings → Domains** → add the domain and follow the DNS instructions. HTTPS is automatic.

### Updating later

Edit a file on GitHub (or upload a new version) and commit. Vercel redeploys automatically in about a minute. Your data lives in Upstash, so updates never touch it.

---

## Using it

### Building an exam
- **Questions** tab: choose *Multiple choice* or *Numeric answer* for each question. Click the **letter** next to a choice to mark it correct. Use the arrows to reorder, the copy icon to duplicate.
- **Settings** tab: everything shows its default. **Reset to defaults** puts it all back. Under *Defaults for new questions* set the time, points and tolerance that every new question starts with, and **Apply to all** pushes them onto existing questions.
- **Results** tab: live results, risk flags, item analysis, Excel export.
- Questions and settings lock while an exam is open. Click **Close exam** to edit.

### Formulas (standard notation)
Type formulas the easy way. Students see them typeset (stacked fractions, real square roots, superscripts, subscripts, Greek letters):

| You type | Students see |
|---|---|
| `x=y/z` | x = y over z (stacked fraction) |
| `v^2`, `a_1`, `v_0^2` | v², a₁, v₀² |
| `sqrt(a+b)` | square root of (a + b) |
| `theta`, `pi`, `omega`, `Delta` | θ, π, ω, Δ |
| `$E = 1/2 m v^2$` | anything between dollar signs is always typeset |

Plain words like "and/or" or "km/h" are left alone. Use `$…$` when you want to be sure.

**Answer formulas** for "different numbers per student" questions are forgiving: `0.5*a*t^2`, `0.5at^2`, `F = m a`, `2(x+1)`, `sqrt(2gh)`, `×`, `÷`, `²` and `π` all work. The editor shows the formula in standard form underneath, and **Preview a sample student** shows the numbers, the answer and how the formula was understood.

**Student numeric answers** accept `3.5`, `3,5`, `1/4`, `3x10^8`, `3e8`, `2pi` and `sqrt(2)`. A live "Reads as…" line under the box shows the student how it was understood.

### What students see afterwards
In **Settings → After the exam** choose:
- **Release results**: *When I close the exam* (default, stops early finishers leaking answers) or *Right after they finish*.
- **Show their score**, **Let them review their answers** (each question marked right or wrong), and **Also show the correct answers**.

Students open it with **View results** on their exam list. If they closed the browser, **Find my results** (bottom of the exam list) restores it using their student ID and the **receipt code** shown when they submitted.

New exams start with score and review on, correct answers off. Exams created before this update keep their old behaviour until you change them.

### Class sittings
Attempts are one per student ID. For a new sitting of the same exam: Results → **Download Excel** → **Clear all attempts**, then open it again.

---

## Optional: live results in Google Sheets
1. Create a Google Sheet → **Extensions → Apps Script**.
2. Paste the contents of `google-apps-script/Code.gs`. **Change `KEY`** at the top to a password you invent.
3. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*. Copy the URL that ends in `/exec`.
4. In Ohmest: exam → **Settings → Google Sheets**. Paste the URL and the same key, click **Test connection**, then Save.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Database not connected" | The two Upstash variables are missing or misspelled. Fix them in Vercel, then **Redeploy**. |
| "AUTH_SECRET is not set on the server" | Add `AUTH_SECRET` in Vercel and **Redeploy**. |
| Signed out all the time | `AUTH_SECRET` changed between deploys, or storage is blocked in the browser. |
| 404 on `/student-login` | `vercel.json` is not at the top level of the repo, so `cleanUrls` and `outputDirectory` were ignored. Move it there. |
| Page loads but nothing works | Open the browser console (F12) and the Network tab. The `/api` response's error message says which variable is missing. |
| "Too many attempts" | Built-in rate limit on sign-in and codes. Wait a few minutes. |
| Excel export button does nothing | The Excel library loads from a CDN. Check the internet connection and refresh. |

## Run it on your computer (optional)
```
npm i -g vercel
npm install
cp .env.example .env.local   # fill in the three values
vercel dev
```

## Data and privacy
Everything is stored in your own Upstash database. Students are identified only by the name and ID they type. Professors' passwords are salted and hashed (scrypt). Work photos are stored in the database and are deleted when you reset a student, clear attempts or delete the exam.