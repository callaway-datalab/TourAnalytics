const { chromium } = require('playwright');
const fs = require('fs');

const MOCK = fs.readFileSync('/tmp/fbmock/mock-firebase.js', 'utf8');
const CHART_STUB = `
window.Chart = class {
  constructor(ctx, cfg) { this.cfg = cfg; window.__lastChartConfig = cfg; }
  destroy() {}
};
Chart.defaults = { font: {} };
`;
const BASE = 'http://127.0.0.1:8899';

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('https://www.gstatic.com/firebasejs/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: CHART_STUB }));
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort());

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  const ok = (cond, label) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  const shot = (name) => page.screenshot({ path: `/tmp/webshots/${name}.png`, fullPage: true });
  // Navigate WITHIN the already-loaded SPA (a real page.goto would reload the page and wipe
  // our in-memory mock backend, since it isn't real Firebase persistence).
  const goHash = (hash) => page.evaluate((h) => { location.hash = h; }, hash);
  const logOut = async () => { await page.click('button:has-text("Log out")'); await page.waitForSelector('.auth-form'); };

  await page.goto(BASE + '/index.html');

  // Simulate the admin having already created their Firebase Auth account via the Console
  // (this app never signs admins up through the invite flow).
  await page.evaluate(async () => {
    const mod = await import('https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js');
    await mod.createUserWithEmailAndPassword(null, 'admin@example.com', 'adminpass123');
    await mod.signOut();
  });

  async function logIn(email, password) {
    await goHash('/login');
    await page.waitForSelector('input[type=email]');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', password);
    await page.click('button.btn');
  }

  // ---------- Admin logs in ----------
  await logIn('admin@example.com', 'adminpass123');
  await page.waitForSelector('h1:has-text("Overview")');
  ok(true, 'admin logs in and lands on Overview');
  await shot('01_admin_home');

  // ---------- Admin: upload a dataset ----------
  await goHash('/admin/datasets');
  await page.waitForSelector('text=Upload a data file');
  const csv = fs.readFileSync('/home/claude/portal-web/sample_data.csv');
  await page.setInputFiles('input[type=file]', { name: 'sample_data.csv', mimeType: 'text/csv', buffer: csv });
  await page.locator('input').nth(1).fill('client_id');
  await page.locator('input').nth(2).fill('Monthly sales');
  await page.locator('input').nth(3).fill('Revenue, orders and returns by month');
  await page.click('button:has-text("Upload data")');
  await page.waitForSelector('text=/Added "Monthly sales": 100 rows for 5 people/');
  ok(true, 'CSV upload parsed and split across 5 clients');
  await shot('02_admin_datasets');

  // ---------- Admin: create invite codes ----------
  await goHash('/admin/clients');
  await page.waitForSelector('text=Create an access code');
  async function createInvite(clientId) {
    await page.fill('.inline-form input >> nth=0', clientId);
    await page.click('button:has-text("Create code")');
    await page.waitForSelector('.flash.ok');
    const flashText = await page.locator('.flash.ok').first().textContent();
    return flashText.match(/([A-Z0-9]{5}-[A-Z0-9]{5})/)[1];
  }
  const codeAlice = await createInvite('C1001');
  const codeBob = await createInvite('C1002');
  ok(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(codeAlice), 'invite code created with expected format: ' + codeAlice);
  await page.waitForTimeout(200);
  await shot('03_admin_clients');
  await logOut();

  // ---------- Sign up two clients ----------
  async function signUp(code, name, email) {
    await goHash(`/signup?code=${encodeURIComponent(code)}`);
    await page.waitForSelector('.code-input');
    await page.fill('.code-input', code);
    await page.fill('input[autocomplete=name]', name);
    await page.fill('input[type=email]', email);
    await page.fill('input[autocomplete="new-password"] >> nth=0', 'a-long-password-1');
    await page.fill('input[autocomplete="new-password"] >> nth=1', 'a-long-password-1');
    await page.click('button:has-text("Create account")');
    await page.waitForSelector('.page-head h1');
  }
  await signUp(codeAlice, 'Alice Alvarez', 'alice@example.com');
  ok(await page.isVisible('text=Hello, Alice'), 'Alice signs up and reaches her dashboard');
  await shot('04_alice_dashboard');

  const dashboardHtml = await page.content();
  ok(dashboardHtml.includes('Monthly sales') && dashboardHtml.includes('20 rows'), 'Alice sees her dataset with 20 rows (her share only)');
  await logOut();

  // Reject a bogus code
  await goHash('/signup');
  await page.waitForSelector('.code-input');
  await page.fill('.code-input', 'AAAAA-BBBBB');
  await page.fill('input[autocomplete=name]', 'Nobody');
  await page.fill('input[type=email]', 'nobody@example.com');
  await page.fill('input[autocomplete="new-password"] >> nth=0', 'a-long-password-1');
  await page.fill('input[autocomplete="new-password"] >> nth=1', 'a-long-password-1');
  await page.click('button:has-text("Create account")');
  await page.waitForSelector('.flash.error');
  ok(await page.isVisible("text=isn't valid"), 'a made-up invite code is rejected');

  // ---------- Alice opens her dataset: table + chart ----------
  await logIn('alice@example.com', 'a-long-password-1');
  await page.waitForSelector('text=Hello, Alice');
  await page.click('a:has-text("Monthly sales")');
  await page.waitForSelector('#tbl tbody tr');
  await page.waitForTimeout(300);
  await shot('05_alice_dataset');
  const rowCount = await page.locator('#tbl tbody tr').count();
  ok(rowCount === 20, `Alice's table shows her 20 rows (got ${rowCount})`);
  const headerText = await page.locator('#tbl thead').textContent();
  ok(!headerText.includes('client_id'), 'the ID column is hidden from the client view');

  // chart interactivity
  await page.selectOption('.controls select >> nth=1', { label: 'region' });
  await page.selectOption('.controls select >> nth=0', 'pie');
  await page.waitForTimeout(100);
  const cfgAfterPie = await page.evaluate(() => window.__lastChartConfig);
  ok(cfgAfterPie.type === 'doughnut', 'switching to pie chart reconfigures Chart.js as a doughnut');

  // sort + search
  await page.click('#tbl th:nth-child(3) button');
  const firstAsc = await page.locator('#tbl tbody tr').first().locator('td').nth(2).textContent();
  await page.click('#tbl th:nth-child(3) button');
  const firstDesc = await page.locator('#tbl tbody tr').first().locator('td').nth(2).textContent();
  ok(firstAsc !== firstDesc, `sorting toggles order (asc first=${firstAsc}, desc first=${firstDesc})`);
  await page.fill('.search input', 'East');
  await page.waitForTimeout(50);
  const filteredCount = await page.locator('#count').textContent();
  ok(filteredCount !== `${rowCount} rows`, 'search filters the table: ' + filteredCount);
  await page.fill('.search input', '');
  await page.waitForTimeout(50);
  await logOut();

  // ---------- Bob signs up and gets DIFFERENT data (isolation check via UI only) ----------
  await signUp(codeBob, 'Bob Brown', 'bob@example.com');
  await page.click('a:has-text("Monthly sales")');
  await page.waitForSelector('#tbl tbody tr');
  const bobRowCount = await page.locator('#tbl tbody tr').count();
  ok(bobRowCount === 20, `Bob's table also shows 20 rows of his own (got ${bobRowCount})`);
  const bobFirstRow = await page.locator('#tbl tbody tr').first().textContent();
  await logOut();

  await logIn('alice@example.com', 'a-long-password-1');
  await page.waitForSelector('text=Hello, Alice');
  await page.click('a:has-text("Monthly sales")');
  await page.waitForSelector('#tbl tbody tr');
  const aliceFirstRow = await page.locator('#tbl tbody tr').first().textContent();
  ok(aliceFirstRow !== bobFirstRow, "Alice's and Bob's first rows differ (separate data)");

  // ---------- Alice asks a question; admin gets alert; admin replies; Alice sees it ----------
  await goHash('/questions');
  await page.waitForSelector('text=Ask a question');
  await page.click('a:has-text("Ask a question")');
  await page.waitForSelector('textarea');
  await page.fill('input[required]', 'Why did March dip?');
  await page.fill('textarea', 'Revenue looks lower than I expected in March.');
  await page.click('button:has-text("Send question")');
  await page.waitForSelector('.messages li');
  await shot('06_alice_question');
  await logOut();

  await logIn('admin@example.com', 'adminpass123');
  await page.waitForSelector('h1:has-text("Overview")');
  await page.waitForTimeout(300);
  const badgeText = await page.locator('[data-unread-badge]').first().textContent();
  ok(badgeText === '1', `admin sees unread badge = ${badgeText}`);
  await goHash('/admin/questions');
  await page.click('text=Why did March dip?');
  await page.waitForSelector('.messages li');
  await page.fill('textarea', 'March had a billing delay. It is corrected in April.');
  await page.click('button:has-text("Send reply")');
  await page.waitForTimeout(200);
  await shot('07_admin_reply');
  const messagesAfterReply = await page.locator('.messages li').count();
  ok(messagesAfterReply === 2, 'thread now has question + reply');
  await logOut();

  await logIn('alice@example.com', 'a-long-password-1');
  await page.waitForSelector('text=Hello, Alice');
  await page.waitForTimeout(300);
  const aliceBadge = await page.locator('[data-unread-badge]').first().textContent();
  ok(aliceBadge === '1', `Alice sees unread badge after admin reply = ${aliceBadge}`);
  await goHash('/questions');
  await page.click('text=Why did March dip?');
  await page.waitForSelector('text=billing delay');
  ok(true, 'Alice can read the reply');
  await logOut();

  // ---------- Admin: documents ----------
  await logIn('admin@example.com', 'adminpass123');
  await page.waitForSelector('h1:has-text("Overview")');
  await goHash('/admin/documents');
  await page.waitForSelector('text=Upload a document');
  await page.setInputFiles('input[type=file]', { name: 'q2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('input').nth(1).fill('Q2 review');
  await page.click('button:has-text("Upload document")');
  await page.waitForSelector('text=Document uploaded');
  await shot('08_admin_documents');
  await logOut();

  await logIn('alice@example.com', 'a-long-password-1');
  await page.waitForSelector('text=Hello, Alice');
  await goHash('/documents');
  await page.waitForSelector('text=Q2 review');
  ok(true, 'Alice sees the shared document in her library');
  await logOut();

  // ---------- Admin preview mode ----------
  await logIn('admin@example.com', 'adminpass123');
  await page.waitForSelector('h1:has-text("Overview")');
  await goHash('/admin/clients');
  await page.waitForSelector('text=c1002');
  await page.click('a:has-text("See their portal")');
  await page.waitForSelector('.preview-bar');
  await shot('09_admin_preview');
  ok(await page.isVisible('text=Client view'), 'admin preview shows "Client view" heading');
  await page.click('.preview-bar >> text=Exit preview');
  await page.waitForSelector('h1:has-text("Overview")');
  ok(true, 'exiting preview returns to admin overview');

  // mobile viewport check (fresh page load is fine here, we're done with shared state)
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 800 });
  await mobile.goto(BASE + '/index.html#/login');
  await mobile.screenshot({ path: '/tmp/webshots/10_mobile_login.png', fullPage: true });

  console.log('\nJS errors observed:', errors.length ? errors : 'none');
  await browser.close();
})();
