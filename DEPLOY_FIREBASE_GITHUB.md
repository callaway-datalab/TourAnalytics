# Set up: GitHub Pages + Firebase

Everything below happens in your browser (GitHub's website and the Firebase console). No installs.
Budget about 30 minutes.

> **Heads-up about the Firebase console.** Google reorganized the console's left sidebar in 2026.
> Products are no longer listed one by one; they're grouped into **flyout menus** you click to open.
> The two you need:
>
> | You're looking for   | Where it lives now                                          |
> | -------------------- | ----------------------------------------------------------- |
> | Authentication       | Sidebar → **Security** → **Authentication**                 |
> | Firestore Database   | Sidebar → **Databases & Storage** → under NoSQL, **Firestore** |
>
> After you've opened a product once, it also appears under **Project shortcuts** at the top of
> the sidebar, which is the quickest way back to it.
>
> Consoles keep changing. If a label below doesn't match what you see, look for the closest thing
> — the steps themselves don't change.

---

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with a
   **personal** Google account (work/school accounts are often blocked from creating projects).
2. Start a new project:
   - If you've never used Firebase: click the big card **"Get started by setting up a Firebase
     project."**
   - If you already have projects: click **Create a project** (or **Add project**).
3. **Name screen.** Type any name (e.g. `acme-client-portal`). Leave the auto-generated project ID
   underneath alone.
   - Leave **I accept the Firebase terms** ticked.
   - "Join the Google Developer Program" is optional — turn it off if you don't want emails.
   - Click **Continue**.
4. **Gemini / AI assistance screen.** Not needed for this app — turn it off and click **Continue**.
5. **Google Analytics screen.** Turn it **off** (not needed). Click **Continue** / **Create project**.
6. Wait for "Your Firebase project is ready" and click **Continue**. You're now on the project
   overview, on the free **Spark** plan (shown next to the project name). Don't upgrade.

## 2. Turn on email/password login

1. Left sidebar → **Security** → **Authentication**.
2. Click **Get started**.
3. You land on the **Sign-in method** tab. Under "Native providers" click **Email/Password**.
4. Turn on the **first** toggle ("Email/Password"). Leave the second one ("Email link
   (passwordless sign-in)") **off**. Click **Save**.
5. Email/Password now shows **Enabled** in the list.

## 3. Create the database

1. Left sidebar → **Databases & Storage** → under **NoSQL**, click **Firestore**.
   (Not "Realtime Database" — that's a different product listed nearby.)
2. Click **Create database**. The wizard has three steps:
   1. **Select edition** — leave **Standard** selected → **Next**.
   2. **Database ID & location** — leave the ID as `(default)`. Pick a location near you
      (e.g. `us-west1` for California). This can't be changed later. → **Next**.
   3. **Configure** — choose **Start in production mode** (not test mode) → **Create**.
3. You'll land on the Data tab of an empty database. That's expected.

## 4. Create your admin account and copy its UID

1. Sidebar → **Security** → **Authentication** (or use **Project shortcuts**) → **Users** tab →
   **Add user**.
2. Enter your own email and a password. This is how you'll log in as the administrator.
3. Your new user appears in the table. Find the **User UID** column (a long string like
   `a1B2c3D4e5F6...`). Hover over it and click the copy icon.
   Paste it into a notepad for now — you'll need it in **two** places (steps 5 and 7).

## 5. Publish the security rules

1. On your computer, open this project's `firestore.rules` in any text editor. Near the top, find:
   ```
   return ['REPLACE_WITH_ADMIN_UID'];
   ```
   Replace `REPLACE_WITH_ADMIN_UID` with your UID, **keeping the quotes**:
   ```
   return ['a1B2c3D4e5F6...'];
   ```
   Save the file.
2. In the Firebase console: **Firestore** → **Rules** tab. Select everything in the editor and
   delete it, then paste in the **entire** edited file. Click **Publish**.

## 6. Register the web app and get your config values

1. Click the **gear icon** next to "Project Overview" (top of the sidebar) → **Project settings** →
   **General** tab.
2. Scroll down to **Your apps** and click the web icon **`</>`**.
3. Enter any nickname. Leave **"Also set up Firebase Hosting"** unticked (you're using GitHub Pages).
   Click **Register app**.
4. On the "Add Firebase SDK" step, pick either option ("Use npm" or "Use a `<script>` tag"; it
   doesn't matter, you won't use the rest of that code). Somewhere in the code block is a
   `firebaseConfig` object. That's the only part you need. It looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   Keep this page open, then click **Continue to console** when you're done. (To see these values
   again later: Project settings → General → scroll to **Your apps** → under "SDK setup and
   configuration", choose **Config**, which shows just the object.)

## 7. Create config.js

1. In the project folder, make a copy of `config.example.js` and name the copy `config.js`
   (same folder as `index.html`).
2. Open `config.js`. Fill in three things:
   - **`portalName`** — whatever you want shown in the sidebar and browser tab.
   - **`firebase`** — replace the six `REPLACE_ME` lines with the six lines from the console.

     ⚠️ **Only copy the lines *inside* the curly braces.** Don't paste the console's
     `const firebaseConfig = {` line into `config.js` — the file must keep its own
     `firebase: {` line, or the app won't find your settings and will show "Setup needed."
     Use whatever `storageBucket` value the console gives you, even if it ends in
     `.firebasestorage.app` instead of `.appspot.com`.
   - **`adminUids`** — `["your-uid-here"]`, the **same** UID you put in `firestore.rules`.

   When you're done it should look like this:
   ```js
   window.PORTAL_CONFIG = {
     portalName: "Acme Client Portal",

     firebase: {
       apiKey: "AIza...",
       authDomain: "your-project.firebaseapp.com",
       projectId: "your-project",
       storageBucket: "your-project.firebasestorage.app",
       messagingSenderId: "1234567890",
       appId: "1:1234567890:web:abc123",
     },

     adminUids: ["a1B2c3D4e5F6..."],
   };
   ```
3. Double-check: search the file for `REPLACE` — there should be no matches left.

## 8. Put it on GitHub Pages

1. On GitHub, create a new repository. Public is simplest (Pages on a private repo needs GitHub
   Pro, Team, or Enterprise).
2. Upload every file from this project, **including your edited `config.js` and
   `firestore.rules`**, keeping the folders (`css/`, `js/`, `js/views/`, etc.) intact.
   No command line needed: on the repo page, **Add file → Upload files**, then drag the **contents**
   of the unzipped `portal-web` folder in (so `index.html` ends up at the top level of the repo,
   not inside a `portal-web/` subfolder). Click **Commit changes**.
   - `.nojekyll` is a hidden file and may not get dragged in. If it's missing afterwards, use
     **Add file → Create new file**, name it `.nojekyll`, leave it empty, and commit.
3. Repo **Settings → Pages**. Under "Build and deployment": **Source** = **Deploy from a branch**,
   branch **main**, folder **/ (root)**. Click **Save**.
4. After a minute or two, the Pages settings page shows your link, like
   `https://yourname.github.io/your-repo/`.

## 9. Tell Firebase about your site's address

1. Firebase console → **Security** → **Authentication** → **Settings** tab → **Authorized domains**.
2. Click **Add domain** and enter `yourname.github.io` (just the domain — no `https://`, no repo
   name). Save.

This keeps Firebase's login features (like password-reset links) working from your GitHub Pages
site.

## 10. Try it

1. Open your GitHub Pages link and log in with the admin email/password from step 4.
2. **Data → Upload** → upload `sample_data.csv` (made-up strokes-gained data included in this project) with ID
   column `playerID`. Open **Data → Analyze** to see the dashboard.
3. **Player Access** → **Create New Access Code** → User Type Player → start typing `Alex Moreno` → Create code → copy it.
4. Open a private/incognito window, go to `your-site-url/#/signup?code=THECODE`, and create a test
   account. You should see that person's 20 rows of sample data and a chart, and be able to ask a
   question that shows up in your admin inbox with an alert.
5. Once it works, delete the sample data from the **Data** page and start uploading your own.

---

## Using it day to day

- **Add data**: Data page → upload a CSV or Parquet file with one column identifying who each row
  belongs to. Uploading again with the same name replaces that dataset.
- **Invite someone**: Clients & codes → type their ID exactly as it appears in your data (matching
  ignores capitals and spaces) → Create code → send them the code and your site's `#/signup` link.
- **Share a document**: Documents page → upload a PDF or PowerPoint → choose Everyone or one player.
  When you pick one player, tick any roles on their team (Coach, Caddy, ...) that should also see
  it. Leave them all unticked to share with the player only.
- **Coaches, caddies and other team members** come from one file you keep: your **team roster**,
  a CSV with the columns `player, playerID, team member, team role, team member email`, one row per
  player per team member (`team_members_template.csv` in this project is an example). `playerID`
  says exactly which player; the email is how the team member signs up. Team role is Coach, Caddy or
  Other. Upload it on **Player Access → Team roster** whenever it changes:
  - Each upload **replaces** the previous roster: anyone you take out loses access immediately.
  - Anyone new gets an access code (see Access codes) that only works with their email.
  - A file with a mistake is rejected as a whole, so a typo never silently removes someone.
  - "Download current roster" gives you back exactly what's live, in the same format.
- **Record a round (anyone)**: **Data Entry → Start a new round**. Enter the date, start typing the
  course (pick it from the list and the location fills in; a course you've played before also refills
  its scorecard and tees), and the tees. Then the scorecard: tap each hole's par and type its yardage and handicap, or tap **Read a
  scorecard photo** and check what it filled in. **Start round**, then for each shot pick where it
  started and where it finished (lie chips) and the distance. Every change saves automatically.
  Everyone records their own rounds (you included). Entered rounds show under **Stats → Analyze →
  Entered Rounds** (pick **Me** for your own) and on each player's **My Stats → Entered Rounds**;
  coaches pick **Me** in their player dropdown for theirs. Strokes-gained numbers are placeholders for now.
- **Questions and password**: under **Account** (top right): your email, **Questions** and **Reset Password**.
- **Answer a question**: a badge appears in your sidebar and browser tab; click Questions, open the
  thread, reply.
- **See what a client sees**: Clients & codes → "See their portal" next to their name.
- **Reset a client's password**: Clients & codes → "Send password reset" — Firebase emails them a
  reset link directly.
- **Remove someone's access**: Clients & codes → "Remove access". This deletes their profile, which
  immediately blocks them from all client data. Their login technically still exists; to remove it
  completely, also delete them in Firebase console → Security → Authentication → Users.

## Costs

Firebase's free **Spark** plan covers Authentication and Firestore with no billing account. The
free limits (see [firebase.google.com/pricing](https://firebase.google.com/pricing)) are generous
for a personal or small-business portal. If you outgrow them, Firebase asks you to add billing
rather than silently charging you. GitHub Pages is free for public repositories.

## If something's wrong

- **Can't find a menu item in the Firebase console**: check the flyouts — **Security** (for
  Authentication) and **Databases & Storage** (for Firestore). Also check **Project shortcuts** at
  the top of the sidebar.
- **Blank page or "Setup needed"**: `config.js` is missing, is still named `config.example.js`, still
  contains `REPLACE_ME`, or you pasted the console's `const firebaseConfig = {` line over the
  `firebase: {` line. Re-check step 7.
- **Page loads but everything 404s / no styling**: the files ended up inside a `portal-web/`
  subfolder in your repo. `index.html` must be at the top level of the repo.
- **Login says the operation isn't allowed**: Email/Password isn't enabled. Re-check step 2.
- **"Missing or insufficient permissions" in the browser console**: the UID in `firestore.rules`
  doesn't match the one in `config.js`, or the rules weren't published. Re-check steps 5 and 7.
- **Admin screens look empty**: same cause as above — the UID doesn't match in both places.
- **A page asks you to create a Firestore index**: click the link in the browser console error; it
  creates the index in one step and the page works a minute later.
- **Changes not showing up**: GitHub Pages takes a minute or two to rebuild after you upload.
  Then hard-refresh (Ctrl/Cmd+Shift+R).
