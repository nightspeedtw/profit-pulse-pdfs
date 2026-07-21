import { Helmet } from "react-helmet-async";

export default function Terms() {
  return (
    <div className="container max-w-3xl py-16">
      <Helmet>
        <title>Terms & Conditions · SecretPDF</title>
        <meta name="description" content="Terms and conditions for using SecretPDF, operated by Sandking Company Limited." />
      </Helmet>

      <article className="prose prose-neutral max-w-none">
        <h1>Terms &amp; Conditions</h1>
        <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>

        <h2>1. Who we are</h2>
        <p>
          The Service is operated by <strong>Sandking Company Limited</strong> ("Sandking", "we", "us"),
          trading as <strong>SecretPDF</strong>. By creating an account, purchasing a product, or otherwise
          using the Service, you enter into a contract with Sandking on these terms.
        </p>

        <h2>2. Acceptance and authority</h2>
        <p>
          By continuing to use the Service you confirm you accept these Terms, you are at least the age
          of legal majority in your jurisdiction, and, if using the Service on behalf of an organisation,
          you have authority to bind that organisation.
        </p>

        <h2>3. The Service</h2>
        <p>
          SecretPDF sells digital downloads (illustrated PDFs, coloring books, storybooks and related
          content) and offers optional book subscriptions with monthly credit allowances. Some products
          and features use generative AI. Digital products are delivered electronically via download link
          or account library.
        </p>

        <h2>4. Payments, subscriptions, and refunds</h2>
        <p>
          Our order process is conducted by our online reseller <strong>Paddle.com</strong>.
          Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service
          inquiries and handles returns. Payment, billing, taxes, currency conversion, invoicing,
          subscription renewals, cancellations and refunds are governed by the Paddle
          {" "}
          <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noreferrer">Checkout Buyer Terms</a>
          {" "}and the Paddle
          {" "}
          <a href="https://www.paddle.com/legal/refund-policy" target="_blank" rel="noreferrer">Refund Policy</a>.
          Subscriptions renew automatically at the end of each billing period until cancelled. Please
          also see our <a href="/refund-policy">Refund Policy</a>.
        </p>

        <h2>5. Account</h2>
        <p>
          You are responsible for keeping your account credentials confidential and for all activity
          under your account. You must provide accurate information and keep it up to date. Tell us
          promptly at <a href="mailto:support@secretpdf.co">support@secretpdf.co</a> if you suspect
          unauthorised use.
        </p>

        <h2>6. Licence</h2>
        <p>
          Subject to payment of applicable fees, we grant you a limited, personal, non-exclusive,
          non-transferable licence to download and use purchased digital products for your own personal
          or household use. Where a product is expressly sold with a "commercial use" licence, that
          licence's scope applies.
        </p>

        <h2>7. Restrictions and acceptable use</h2>
        <p>You must not, and must not permit others to:</p>
        <ul>
          <li>Use the Service unlawfully, or to infringe the rights of others.</li>
          <li>Resell, redistribute, sublicense, or publicly share purchased files, in whole or in part,
              except as expressly permitted by a specific product licence.</li>
          <li>Reverse engineer, decompile, scrape, probe, or interfere with the Service's security.</li>
          <li>Upload malware, send spam, or engage in fraud or chargeback abuse.</li>
          <li>Use AI features to create illegal content, non-consensual sexual content, sexual content
              involving minors, deepfakes of real individuals without consent, content that promotes
              violence or hatred, malware, or content that infringes intellectual property.</li>
          <li>Attempt to jailbreak, prompt-inject, or bypass safety measures in AI features.</li>
        </ul>

        <h2>8. AI-generated content</h2>
        <p>
          Some outputs are generated with the assistance of AI models. You are responsible for the
          prompts you submit, for verifying the accuracy and suitability of outputs, and for ensuring
          you have the rights to any content you upload as input. AI outputs may be inaccurate,
          incomplete, or unsuitable and must not be relied on as professional advice (legal, medical,
          financial or otherwise). To the extent permitted by law, and subject to the input you provided
          and third-party rights, ownership of AI outputs generated for you through the Service is
          assigned to you upon payment; some jurisdictions may limit the copyrightability of AI-generated
          material. We may filter, refuse, or remove outputs and may suspend accounts that violate this
          section. Rights-holders who believe content on the Service infringes their rights may submit a
          takedown request to <a href="mailto:legal@secretpdf.co">legal@secretpdf.co</a>; repeat infringers
          will have their accounts terminated.
        </p>

        <h2>9. Intellectual property</h2>
        <p>
          The Service and its underlying software, design, brand, and catalogue metadata are owned by
          Sandking or its licensors and are protected by intellectual property laws. Nothing in these
          Terms transfers any rights to you except the limited licences expressly granted.
        </p>

        <h2>10. User content</h2>
        <p>
          You retain ownership of content you submit. You grant Sandking a worldwide, non-exclusive,
          royalty-free licence to host, process, transmit and display your content solely to operate
          and provide the Service to you.
        </p>

        <h2>11. Service level and warranties</h2>
        <p>
          The Service is provided "as is" and "as available". We do not guarantee that the Service will
          be uninterrupted, timely, secure, or error-free. To the fullest extent permitted by law we
          disclaim all implied warranties, including merchantability, fitness for a particular purpose,
          and non-infringement.
        </p>

        <h2>12. Liability</h2>
        <p>
          To the fullest extent permitted by law, our aggregate liability arising out of or relating to
          the Service in any 12-month period is limited to the amount you paid to Paddle for the Service
          during that period. We are not liable for indirect, incidental, special, consequential, or
          punitive damages, or for loss of profits, revenue, data, or goodwill. Nothing in these Terms
          excludes liability for fraud, death or personal injury caused by negligence, or any other
          liability that cannot be excluded by law.
        </p>

        <h2>13. Indemnity</h2>
        <p>
          You will indemnify Sandking against claims, damages and reasonable costs arising from your
          content, your use of the Service in breach of these Terms, or your infringement of any law
          or third-party right.
        </p>

        <h2>14. Suspension and termination</h2>
        <p>
          We may suspend or terminate access to the Service for material breach of these Terms,
          non-payment, suspected fraud or security risk, or repeated or serious policy violations.
          You may close your account at any time from account settings. Sections that by their nature
          survive termination (IP, restrictions, disclaimers, liability, indemnity, governing law)
          will continue to apply.
        </p>

        <h2>15. Consequences of termination</h2>
        <p>
          On termination you will lose access to the Service and to previously purchased downloads via
          your library. Where possible you should download files you have purchased before closing the
          account. We may retain records as required by law.
        </p>

        <h2>16. Changes to the Service or Terms</h2>
        <p>
          We may modify the Service or these Terms from time to time. Material changes will be posted
          on this page with an updated date and, where appropriate, notified by email. Continued use
          after changes take effect constitutes acceptance.
        </p>

        <h2>17. Governing law and disputes</h2>
        <p>
          These Terms are governed by the laws of the jurisdiction where Sandking Company Limited is
          established, without regard to conflict-of-laws rules. Disputes will be subject to the
          exclusive jurisdiction of the competent courts of that jurisdiction, subject to any mandatory
          consumer rights you have where you reside.
        </p>

        <h2>18. Assignment and force majeure</h2>
        <p>
          You may not assign these Terms without our consent. We may assign them in connection with a
          merger, acquisition, or sale of assets. Neither party is liable for failure or delay caused by
          events beyond its reasonable control.
        </p>

        <h2>19. Contact</h2>
        <p>
          Sandking Company Limited — <a href="mailto:support@secretpdf.co">support@secretpdf.co</a>.
        </p>
      </article>
    </div>
  );
}
