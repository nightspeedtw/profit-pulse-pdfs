import { Helmet } from "react-helmet-async";

export default function RefundPolicy() {
  return (
    <div className="container max-w-3xl py-16">
      <Helmet>
        <title>Refund Policy · SecretPDF</title>
        <meta name="description" content="SecretPDF 30-day money-back guarantee. Refunds handled by Paddle, our Merchant of Record." />
      </Helmet>

      <article className="prose prose-neutral max-w-none">
        <h1>Refund Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>

        <p>
          <strong>Sandking Company Limited</strong>, trading as <strong>SecretPDF</strong>, offers a
          <strong> 30-day money-back guarantee</strong> on purchases made through our Service. If you
          are not satisfied with your purchase, you can request a full refund within 30 days of your
          order date.
        </p>

        <h2>How refunds work</h2>
        <p>
          Our order process is conducted by our online reseller <strong>Paddle.com</strong>. Paddle is
          the Merchant of Record for all our orders and handles refunds on our behalf under the Paddle
          {" "}
          <a href="https://www.paddle.com/legal/refund-policy" target="_blank" rel="noreferrer">Refund Policy</a>.
        </p>

        <h2>How to request a refund</h2>
        <ol>
          <li>
            Go to <a href="https://paddle.net" target="_blank" rel="noreferrer">paddle.net</a> and look
            up your order using the email address you purchased with.
          </li>
          <li>Follow the prompts to request a refund, or contact Paddle support from that page.</li>
          <li>
            Alternatively, email us at <a href="mailto:support@secretpdf.co">support@secretpdf.co</a>
            {" "}with your order email and receipt number and we will help arrange the refund.
          </li>
        </ol>

        <h2>Subscriptions</h2>
        <p>
          You can cancel a subscription at any time from your account settings or from the Paddle
          customer portal linked in your receipt email. Cancellation stops future renewals. Refunds for
          the current billing period are handled under Paddle's refund policy and this money-back
          guarantee.
        </p>

        <h2>Processing time</h2>
        <p>
          Once approved, refunds are returned to the original payment method. Depending on your bank or
          card provider, funds typically appear within 5–10 business days.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Email <a href="mailto:support@secretpdf.co">support@secretpdf.co</a>.
        </p>
      </article>
    </div>
  );
}
