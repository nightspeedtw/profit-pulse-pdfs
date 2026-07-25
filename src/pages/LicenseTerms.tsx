import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

export default function LicenseTerms() {
  return (
    <div className="container max-w-3xl py-12 prose prose-sm md:prose-base">
      <Helmet>
        <title>License Terms · SecretPDF</title>
        <meta name="description" content="SecretPDF Kids licensing: Personal Use and Commercial Activity License." />
      </Helmet>
      <h1>License Terms</h1>
      <p>Every SecretPDF Kids book is licensed under one of exactly two licenses.</p>

      <h2>1. Personal Use License — $14.99</h2>
      <ul>
        <li>One buyer or household.</li>
        <li>Personal, non-commercial printing only.</li>
      </ul>

      <h2>2. Commercial Activity License — $39</h2>
      <ul>
        <li>One buyer, educator, organization, or business.</li>
        <li>
          May print and use the book in paid or unpaid activities with students, children, clients,
          camps, playgroups, workshops, cafes, or events.
        </li>
        <li>
          May <strong>not</strong> resell, redistribute, upload, share, sublicense, use for
          print-on-demand, or create competing products from the original files.
        </li>
      </ul>

      <h2>Commercial Subscriptions</h2>
      <p>
        <strong>Commercial 25</strong> — $149/month, 25 commercial book credits per billing period.
        <br />
        <strong>Commercial 50</strong> — $249/month, 50 commercial book credits per billing period.
      </p>
      <p>
        One book unlock costs one credit. Credits roll over for one additional billing period only.
        A customer may claim commercial rights only while their subscription is active.
      </p>
      <p>
        When a subscription ends, all previously claimed books become Personal Use only after the
        paid billing period ends. Your ability to access previously downloaded files is never
        revoked — but commercial activity rights are inactive after cancellation.
      </p>

      <p>
        <Link to="/legal/terms">General Terms</Link> ·{" "}
        <Link to="/refund-policy">Refund Policy</Link> ·{" "}
        <Link to="/privacy">Privacy</Link>
      </p>
    </div>
  );
}
