# Set up: GitHub Pages + Firebase

Everything below happens in your browser — GitHub's website and Firebase's console. No installs
required. About 20 minutes.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and **Add project**.
   Give it any name; Google Analytics isn't needed, you can decline it.
2. **Authentication** (left sidebar) → **Get started** → under "Sign-in method", enable
   **Email/Password**.
3. **Firestore Database** (left sidebar) → **Create database** → start in **production mode** →
   pick any region close to you.

## 2. Create your admin account

1. Still in **Authentication** → **Users** tab → **Add user**. Enter your own email and a password
   — this is how you'll log in as the administrator.
2. Click the user you just created and copy their **User UID** (a long string like
   `a1B2c3D4e5F6...`). You'll need it twice, in the next two steps.

## 3. Set the security rules

1. In this project's files, open `firestore.rules`, and near the top find the line:
   ```
   return ['REPLACE_WITH_ADMIN_UID'];
   ```
   Replace `REPLACE_WITH_ADMIN_UID` with the UID you copied (keep the quotes), e.g.
   `return ['a1B2c3D4e5F6...'];`.
2. In the Firebase Console: **Firestore Database** → **Rules** tab. Delete what's there and paste
   in the whole edited file. Click **Publish**.

## 4. Register a web app and get your config

1. Firebase Console → the gear icon (top left) → **Project settings**.
2. Under "Your apps", click the **</>** (web) icon → give it any nickname → **Register app**.
   (Skip the "Firebase Hosting" checkbox — you're using GitHub Pages instead.)
3. You'll see a code block with a `firebaseConfig` object (`apiKey`, `authDomain`, etc.). Keep this
   page open, you'll copy from it in the next step.

## 5. Fill in config.js

1. In this project's files, copy `config.example.js` to a new file named `config.js`, in the same
   folder as `index.html`.
2. Open `config.js` and fill in:
   - `portalName`: whatever you want shown in the sidebar and browser tab.
   - `firebase`: paste in the values from the `firebaseConfig` object in step 4.
   - `adminUids`: `["your-uid-here"]` — the **same** UID you put in `firestore.rules`.

## 6. Put it on GitHub Pages

1. Create a new repository on GitHub (public or private both work; Pages on a private repo needs
   GitHub Pro, Team, or Enterprise — public is free either way).
2. Upload every file from this project into the repository, **including your edited `config.js`
   and `firestore.rules`**, keeping the folder structure (`css/`, `js/`, `js/views/`, etc.) intact.
   The easiest way with no command line: on the repository's page, **Add file → Upload files**,
   then drag the whole unzipped folder's contents in.
3. Repository **Settings → Pages**. Under "Build and deployment", set **Source** to
   **Deploy from a branch**, branch **main** (or whichever you used), folder **/ (root)**. Save.
4. GitHub shows a link like `https://yourname.github.io/your-repo/` — that's your site. It takes a
   minute or two to go live the first time.

## 7. Try it

1. Open your GitHub Pages link and log in with the admin email/password from step 2.
2. **Data** → upload `sample_data.csv` (included in this project) with ID column `client_id`, to
   see the portal working end to end.
3. **Clients & codes** → create a code for `C1001` (one of the IDs in the sample data) → copy the
   code.
4. Open a private/incognito window, go to `your-site-url/#/signup?code=THECODE`, and create a test
   account. You should see that person's 20 rows of sample data, a chart, and be able to ask a
   question that shows up in your admin inbox with an alert.
5. Once you've confirmed it works, delete the sample data from the **Data** page and start
   uploading your own.

## Using it day to day

- **Add data**: Data page → upload a CSV or Parquet file with one column identifying who each row
  belongs to. Uploading again with the same name replaces that dataset.
- **Invite someone**: Clients & codes → type their ID exactly as it appears in your data (matching
  ignores capitals and spaces) → Create code → send them the code and your site's `#/signup` link.
- **Share a document**: Documents page → upload a PDF or PowerPoint → choose Everyone or one client.
- **Answer a question**: a badge appears in your sidebar and browser tab; click Questions, open the
  thread, reply.
- **See what a client sees**: Clients & codes → "See their portal" next to their name.
- **Reset a client's password**: Clients & codes → "Send password reset" next to their account —
  Firebase emails them a reset link directly; nothing to configure.
- **Remove someone's access**: Clients & codes → "Remove access". This deletes their profile, which
  immediately blocks them from all client data (Firestore rules check for that profile on every
  read). Their login technically still exists; to remove it completely, delete them in Firebase
  Console → Authentication → Users as well.

## Costs

Firebase's free "Spark" plan covers Authentication and Firestore with no billing account attached.
Free-tier limits (check [firebase.google.com/pricing](https://firebase.google.com/pricing) for
current numbers) are generous for a personal or small-business portal — on the order of tens of
thousands of reads/writes per day and 1 GiB of storage — but if you significantly outgrow that,
Firebase will prompt you to add a billing account (Blaze plan) rather than silently charging you.
GitHub Pages is free for public repositories, and for private repositories on GitHub Pro, Team, or
Enterprise.

## If something's wrong

- **Blank page / "Setup needed" message**: `config.js` is missing or still has placeholder values.
  Re-check step 5.
- **"Missing or insufficient permissions" in the browser console**: usually the UID in
  `firestore.rules` doesn't match the one in `config.js`, or the rules weren't published (step 3).
- **A page asks you to create a Firestore index**: rare with this app's design, but if you see a
  link in the browser console error, clicking it creates the index in one step and the page will
  work a minute later.
- **Changes not showing up on your Pages site**: GitHub Pages can take a minute or two to rebuild
  after you push changes; also try a hard refresh (Ctrl/Cmd+Shift+R).
