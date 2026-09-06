/**
 * The privacy policy, served from the Worker.
 *
 * Google Play blocks a closed-testing rollout without a reachable policy URL,
 * and this app genuinely does collect data: a push token through OneSignal and
 * purchase events through RevenueCat.
 *
 * It is written from the schema rather than from a template. Every item listed
 * below corresponds to a real column in `worker/migrations/`, and the "what we
 * do not collect" list is checkable by reading the same file. A policy that
 * claims less than the code does is a lie; one that claims more is lazy, and
 * Play's Data Safety form will contradict it.
 */

const UPDATED = '2026-09-06';

export const PRIVACY_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lunker — Privacy Policy</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#04171E;color:#D6E5EA;
    font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  main{max-width:44rem;margin:0 auto;padding:3rem 1.25rem 5rem}
  h1{font-size:1.75rem;margin:0 0 .35rem;color:#fff}
  h2{font-size:1.05rem;margin:2.25rem 0 .6rem;color:#3FDBB6}
  .sub{color:#7E9AA3;font-size:.9rem;margin:0 0 2rem}
  table{border-collapse:collapse;width:100%;margin:.5rem 0 1rem;font-size:.92rem}
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #14323C;vertical-align:top}
  th{color:#7E9AA3;font-weight:600}
  code{background:#0B2F39;padding:.1rem .35rem;border-radius:4px;font-size:.88em}
  ul{padding-left:1.1rem}li{margin:.3rem 0}
  a{color:#3FDBB6}
  .foot{margin-top:2.5rem;padding-top:1.25rem;border-top:1px solid #14323C;color:#7E9AA3;font-size:.88rem}
</style></head><body><main>

<h1>Lunker — Privacy Policy</h1>
<p class="sub">Last updated ${UPDATED}</p>

<p>Lunker is a fishing game. It sends you a notification when a fish bites, and it keeps a small
amount of data so that the game can work and so that purchases are honoured. There is no advertising
in Lunker, and nothing here is sold or shared with data brokers.</p>

<h2>What Lunker collects</h2>
<table>
  <tr><th>Data</th><th>Why</th></tr>
  <tr><td>A random player id (<code>angler_</code> + a UUID generated on your device)</td>
      <td>Identifies your save and your purchases. It is not derived from your name, email, phone
          number, or any device identifier, and it is not linked to you as a person.</td></tr>
  <tr><td>Push notification token</td>
      <td>Delivering the bite notification, which is the game itself. Held by OneSignal.</td></tr>
  <tr><td>Game state — current lake, unlocked lakes, streak, rare catches, notification
          permission, and your UTC offset</td>
      <td>Deciding when to send a bite (never while you are likely asleep) and keeping your
          progress across reinstalls.</td></tr>
  <tr><td>Notification timing — when a bite was sent and when it was opened</td>
      <td>Measuring how often bites are answered within the 60-second window. Shown, anonymised
          and in aggregate only, on our public <a href="/verify">verification page</a>.</td></tr>
  <tr><td>Purchase records — product, event type, and amount</td>
      <td>Granting what you bought and honouring subscriptions. Held by RevenueCat.</td></tr>
</table>

<h2>What Lunker does not collect</h2>
<ul>
  <li>No name, email address, phone number, or account sign-in.</li>
  <li>No location, contacts, photos, camera, microphone, or files.</li>
  <li>No advertising identifier, and no advertising or third-party ad SDK of any kind.</li>
  <li>No payment card details — purchases are handled entirely by Google Play.</li>
</ul>

<h2>Who processes data on our behalf</h2>
<ul>
  <li><a href="https://onesignal.com/privacy_policy" rel="noopener">OneSignal</a> — push delivery.</li>
  <li><a href="https://www.revenuecat.com/privacy" rel="noopener">RevenueCat</a> — purchases and
      in-game currency.</li>
  <li><a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">Cloudflare</a> — the server
      and its database.</li>
  <li><a href="https://policies.google.com/privacy" rel="noopener">Google Play</a> — billing.</li>
</ul>

<h2>Notifications</h2>
<p>Lunker asks for notification permission after your first catch, and explains why before asking.
You can decline, and you can revoke it at any time in Android Settings. The game does not work in
any meaningful way without notifications — the notification <em>is</em> the mechanic — but nothing
else about the app is withheld if you say no.</p>

<h2>Children</h2>
<p>Lunker is not directed at children under 13 and does not knowingly collect data from them.</p>

<h2>Keeping and deleting your data</h2>
<p>Game state is kept while you play and for a reasonable period afterwards. Because the player id
is generated on your device and is not tied to an email address, we cannot look you up by name — so
to have your data deleted, send us the player id from the app together with your request and we will
remove the associated rows. Purchase records may be retained where tax or accounting rules require
it.</p>

<h2>Contact</h2>
<p>Questions or a deletion request: <a href="mailto:edy.cu@live.com">edy.cu@live.com</a></p>

<p class="foot">Lunker is an independent app built for the RevenueCat Shipaton 2026. This policy
describes what the shipped code actually does; the data collected is listed table-by-table in the
open-source schema at
<a href="https://github.com/edycutjong/lunker" rel="noopener">github.com/edycutjong/lunker</a>.</p>

</main></body></html>`;
