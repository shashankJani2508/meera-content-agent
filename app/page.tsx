/**
 * The home page: a plain how-to guide for using the Telegram bot.
 * The bot itself has no web interface - everything happens in Telegram.
 */

export default function HomePage() {
  return (
    <main>
      <h1>Meera Content Agent</h1>
      <p className="lead">Turn raw notes from Telegram into LinkedIn drafts in your own voice. You review every draft and publish it yourself.</p>

      <div className="flow" aria-label="How a note moves through the system">
        <span className="stage">Capture</span>→<span className="stage">Evaluate</span>→<span className="stage">Research</span>→
        <span className="stage">Draft</span>→<span className="stage you">You review and publish</span>
      </div>

      <p className="notice">Nothing is ever published or scheduled automatically. The bot only drafts. You are the author of every post.</p>

      <h2>Daily use</h2>
      <ol className="steps">
        <li>
          <h3>Post a note in your &ldquo;My Notes&rdquo; Telegram channel</h3>
          <p>Send it as a normal text message. Rough is fine: a customer question, a factory observation, a label claim that bothers you.</p>
          <p className="muted">
            Notes with an actual point score well, e.g. &ldquo;&lsquo;dermatologist tested&rsquo; doesn&rsquo;t say what was tested or on how many
            people.&rdquo; Reminders like &ldquo;call supplier&rdquo; are rejected on purpose. Voice notes and photos aren&rsquo;t supported yet - send
            text.
          </p>
        </li>
        <li>
          <h3>Wait for the reply</h3>
          <p>It arrives as a reply to your note. You may see &ldquo;typing&hellip;&rdquo; while it works.</p>
          <ul>
            <li>
              <strong>Weak note</strong> (a few seconds): &ldquo;This one isn&rsquo;t strong enough&hellip;&rdquo; with a score out of 10 and one line on
              why. The note is saved, not drafted.
            </li>
            <li>
              <strong>Strong note</strong> (about 20-90 seconds): <code>DRAFT READY · #N</code>
            </li>
          </ul>
        </li>
        <li>
          <h3>Read the draft</h3>
          <ul>
            <li>
              <strong>Top line</strong> - score, word count, and which AI model wrote it.
            </li>
            <li>
              <strong>The post</strong> - 350-550 words in your voice.
            </li>
            <li>
              <strong>
                <code>NEWS SOURCE … ⚠ Check this before publishing</code>
              </strong>{' '}
              - only when a news item was used. Open the link and check the claim: you are its author.
            </li>
            <li>
              <strong>
                <code>TO FILL IN</code>
              </strong>{' '}
              - gaps such as <code>[COMPANY PRACTICE NEEDED: …]</code> where only you have the facts. The AI isn&rsquo;t allowed to invent them.
            </li>
            <li>
              <strong>
                <code>STYLE CHECK</code>
              </strong>{' '}
              - things your own writing never does (an exclamation mark, a hashtag, US spelling). Fix them when you edit.
            </li>
          </ul>
        </li>
        <li>
          <h3>Decide</h3>
          <p>
            Reply <code>APPROVE</code> or <code>REJECT</code>. The message must be just that word, so &ldquo;Reject the new quote&rdquo; still counts as
            a note.
          </p>
          <p className="muted">
            With several drafts waiting, a plain <code>APPROVE</code> applies to the newest. To pick one, use Telegram&rsquo;s Reply on that draft, or
            send <code>APPROVE 12</code> / <code>REJECT 12</code>. Rejected drafts are kept, never deleted.
          </p>
        </li>
        <li>
          <h3>Publish it yourself</h3>
          <p>
            After <code>APPROVE</code>, the bot sends a copy-ready version. Paste it into LinkedIn, fill any <code>[ … ]</code> gaps, check the news
            link, and post.
          </p>
        </li>
      </ol>

      <h2>Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Send</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Any text note</td>
            <td>Saved, scored, and drafted if it scores 6 or more out of 10.</td>
          </tr>
          <tr>
            <td>
              <code>APPROVE</code> / <code>REJECT</code>
            </td>
            <td>Marks the newest pending draft approved or rejected. Nothing is published.</td>
          </tr>
          <tr>
            <td>
              Reply to a draft with <code>APPROVE</code>
            </td>
            <td>Decides that specific draft.</td>
          </tr>
          <tr>
            <td>
              <code>APPROVE 12</code> / <code>REJECT 12</code>
            </td>
            <td>Decides draft #12.</td>
          </tr>
          <tr>
            <td>
              <code>/help</code>
            </td>
            <td>Shows how it works.</td>
          </tr>
        </tbody>
      </table>

      <h2>Where things are</h2>
      <div className="card">
        <ul>
          <li>
            <strong>All history</strong> - Supabase → Table Editor → <code>notes</code> (every note with its score and reason) and <code>drafts</code>{' '}
            (every draft with its news source and status).
          </li>
          <li>
            <strong>Is it running?</strong> - <a href="/api/health">/api/health</a> should show <code>&quot;ok&quot;: true</code> and{' '}
            <code>&quot;database&quot;: &quot;configured&quot;</code>.
          </li>
        </ul>
      </div>

      <h2>For the builder</h2>
      <p className="muted">Run these from the project folder.</p>
      <p>Change the voice (takes effect immediately, no redeploy):</p>
      <pre>
        <code>npm run voice:upload</code>
      </pre>
      <p>Check scoring strictness after editing prompts/scoring.ts:</p>
      <pre>
        <code>npm run calibrate</code>
      </pre>
      <p>Test a note without Telegram:</p>
      <pre>
        <code>npm run try -- &quot;your note here&quot;</code>
      </pre>
      <p>If the bot goes quiet:</p>
      <pre>
        <code>npm run telegram:check</code>
      </pre>
      <pre>
        <code>npm run db:check</code>
      </pre>
      <p>
        To draft with Claude instead of Gemini, add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy.
      </p>

      <footer>Capture → evaluate → research → draft → review. The final publishing decision always belongs to Meera.</footer>
    </main>
  );
}
