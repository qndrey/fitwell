// Values `wrangler types` can't see (secrets, optional vars).
interface Env {
  /** Shown on the privacy page as the contact. Falls back to MAIL_FROM. */
  CONTACT_EMAIL?: string;
}
