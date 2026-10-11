// Stripe client for the Inner Edge account. Read-only restricted key.
// If the account sits under a Connect platform (e.g. GoHighLevel's), set
// IES_STRIPE_ACCOUNT to acct_... and every call is made on that account's behalf.
import Stripe from "npm:stripe@17";
import { env } from "./ies.ts";

export function stripe(): Stripe {
  return new Stripe(env("IES_STRIPE_RESTRICTED_KEY"), { httpClient: Stripe.createFetchHttpClient() });
}

// Spread into a call as the trailing argument. Empty when there is no
// Connect account, because stripe-node rejects an empty {} options object.
export function accountArgs(): [] | [{ stripeAccount: string }] {
  const acct = Deno.env.get("IES_STRIPE_ACCOUNT")?.trim();
  return acct ? [{ stripeAccount: acct }] : [];
}
