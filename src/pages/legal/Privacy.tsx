import { Helmet } from "react-helmet-async";

export default function PrivacyPolicy() {
  return (
    <div className="container max-w-3xl py-16">
      <Helmet>
        <title>Privacy Notice · SecretPDF</title>
        <meta name="description" content="How Sandking Company Limited (SecretPDF) collects, uses, and protects your personal data." />
      </Helmet>

      <article className="prose prose-neutral max-w-none">
        <h1>Privacy Notice</h1>
        <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>

        <p>
          This Privacy Notice explains how <strong>Sandking Company Limited</strong> ("Sandking", "we", "us"),
          trading as <strong>SecretPDF</strong>, collects and processes personal data when you use our
          websites, storefronts, and digital products (the "Service").
        </p>

        <h2>1. Controller</h2>
        <p>
          Sandking Company Limited is the data controller for personal data processed through the Service.
          You can contact us about privacy matters at <a href="mailto:privacy@secretpdf.co">privacy@secretpdf.co</a>.
        </p>

        <h2>2. Categories of personal data we collect</h2>
        <ul>
          <li><strong>Account data</strong> — name, email address, login credentials, profile preferences.</li>
          <li><strong>Order and library data</strong> — products purchased or granted, download history, subscription plan and credits.</li>
          <li><strong>Support data</strong> — messages, attachments, and correspondence you send us.</li>
          <li><strong>Usage and telemetry</strong> — pages viewed, features used, referral source, approximate location derived from IP.</li>
          <li><strong>Device data</strong> — IP address, browser, operating system, device identifiers, cookies.</li>
          <li><strong>User-generated content</strong> — prompts, text, or images you submit to AI-assisted features, and any files you upload.</li>
        </ul>
        <p>Payment card details are collected and processed by Paddle as Merchant of Record. We do not store card numbers.</p>

        <h2>3. Purposes and legal bases</h2>
        <ul>
          <li><strong>Provide the Service</strong> (contract): create your account, deliver purchased PDFs, run subscriptions and credit allowances, operate the customer library.</li>
          <li><strong>Security and fraud prevention</strong> (legitimate interests / legal obligation): detect abuse, protect accounts, keep logs.</li>
          <li><strong>Customer support</strong> (contract / legitimate interests): respond to enquiries and refund requests.</li>
          <li><strong>Product improvement and analytics</strong> (legitimate interests): understand how the Service is used and improve it.</li>
          <li><strong>Marketing</strong> (consent / legitimate interests): send product updates and promotions where permitted; you can opt out at any time.</li>
          <li><strong>Legal compliance</strong> (legal obligation): tax, accounting, responding to lawful requests.</li>
        </ul>

        <h2>4. AI-generated content</h2>
        <p>
          Some products and features on the Service use generative AI models. Inputs you provide to AI
          features (prompts, uploads) may be transmitted to third-party AI providers to generate outputs.
          We do not sell your inputs. Providers may retain inputs for a limited time to prevent abuse in
          line with their own privacy terms. Do not submit sensitive personal data, confidential
          information, or third-party content you do not have the right to use.
        </p>

        <h2>5. Sharing with recipients</h2>
        <p>We share personal data with the following categories of recipients only as needed:</p>
        <ul>
          <li><strong>Merchant of Record (Paddle)</strong> — Paddle.com Market Limited handles checkout,
            payments, tax, invoicing, subscription billing, refunds and related customer service. See
            Paddle's <a href="https://www.paddle.com/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </li>
          <li><strong>Hosting and infrastructure</strong> — cloud hosting, database, storage, and email delivery providers.</li>
          <li><strong>AI providers</strong> — model providers used to generate or moderate content for AI-assisted features.</li>
          <li><strong>Analytics and support tooling</strong> — used solely to operate and improve the Service.</li>
          <li><strong>Professional advisers</strong> — legal, accounting, and audit advisers under confidentiality.</li>
          <li><strong>Authorities</strong> — where required by law, court order, or to protect rights and safety.</li>
        </ul>
        <p>We do not sell personal data.</p>

        <h2>6. International transfers</h2>
        <p>
          Personal data may be processed outside your country of residence, including in the UK, EEA, and
          United States. Where required, transfers rely on appropriate safeguards such as the European
          Commission's Standard Contractual Clauses or an adequacy decision.
        </p>

        <h2>7. Retention</h2>
        <p>
          We keep personal data only as long as needed for the purposes above. Account and order records
          are retained for the life of the account and for the period required by tax and accounting law
          (typically up to 7 years) after closure. Support logs are retained up to 24 months. Analytics
          data is retained in aggregated or pseudonymised form. When no longer needed, data is deleted or
          anonymised.
        </p>

        <h2>8. Your rights</h2>
        <p>Subject to applicable law you may:</p>
        <ul>
          <li>Access the personal data we hold about you.</li>
          <li>Ask us to correct inaccurate data.</li>
          <li>Ask us to erase your data ("right to be forgotten").</li>
          <li>Restrict or object to certain processing.</li>
          <li>Receive your data in a portable format.</li>
          <li>Withdraw consent where processing is based on consent.</li>
          <li>Lodge a complaint with your local data-protection authority.</li>
        </ul>
        <p>
          You can exercise access, export, and deletion rights from your account settings, or by emailing
          <a href="mailto:privacy@secretpdf.co"> privacy@secretpdf.co</a>. We aim to respond within one month.
        </p>

        <h2>9. Security</h2>
        <p>
          We use appropriate technical and organisational measures — encryption in transit, access
          controls, least-privilege service accounts, and audit logging — to protect personal data. No
          system is perfectly secure; please use a strong, unique password.
        </p>

        <h2>10. Cookies</h2>
        <p>
          We use essential cookies to keep you signed in and to remember your cart. We may use analytics
          cookies to understand aggregated usage. You can manage cookies through your browser settings;
          disabling essential cookies may break parts of the Service.
        </p>

        <h2>11. Children</h2>
        <p>
          The Service is intended for adults purchasing on behalf of themselves or their household. We do
          not knowingly collect personal data directly from children under 13 (or the equivalent age in
          your jurisdiction).
        </p>

        <h2>12. Changes</h2>
        <p>
          We may update this notice from time to time. Material changes will be highlighted on this page
          and, where appropriate, notified by email.
        </p>

        <h2>13. Contact</h2>
        <p>
          Sandking Company Limited — <a href="mailto:privacy@secretpdf.co">privacy@secretpdf.co</a>.
        </p>
      </article>
    </div>
  );
}
