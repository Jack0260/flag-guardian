/** A tiny mock "connected GitHub repo". These files are parsed for real with the AST engine. */
export const SAMPLE_FILES: { path: string; source: string }[] = [
  {
    path: "src/checkout/submitOrder.ts",
    source: `import { ldClient } from "../lib/launchdarkly";
import { db } from "../lib/db";

export async function submitOrder(user: User, cart: Cart) {
  const total = cart.items.reduce((s, i) => s + i.price * i.qty, 0);

  if (await ldClient.variation("new_checkout", user, false)) {
    const order = await db.from("orders_v2").insert({ userId: user.id, total });
    await payments.intents.create({ amount: total, orderId: order.id });
    return order;
  } else {
    const order = await db.from("orders_v1").insert({ user_id: user.id, total });
    await fetch("/api/v1/pay", { method: "POST", body: JSON.stringify(order) });
    return order;
  }
}
`,
  },
  {
    path: "src/checkout/CheckoutButton.tsx",
    source: `import { useFlag } from "../lib/launchdarkly";

export function CheckoutButton() {
  const label = useFlag("new_checkout") ? "Pay now" : "Proceed to legacy checkout";
  return <button className="cta">{label}</button>;
}
`,
  },
  {
    path: "src/search/rank.ts",
    source: `import { flags } from "../lib/flags";

export async function rank(query: string) {
  if (!flags.isEnabled("search_ai_ranker")) {
    const res = await fetch("/api/legacy/search?q=" + query);
    return res.json();
  }
  return aiRanker.rank(query);
}

export function emailFooter() {
  if (flags.isEnabled("email_v2")) {
    return renderFooterV2();
  }
  return renderFooterV1();
}

export function reportsTab() {
  return flags.isEnabled("dark_launch_reports") ? "reports-beta" : null;
}
`,
  },
  {
    path: "services/notify/send.py",
    source: `from flags import is_enabled
import sendgrid

def send_welcome(user):
    if is_enabled("email_v2", user):
        return sendgrid.v3.send(template="welcome_v2", to=user.email)
    return sendgrid.v2.send(template="welcome", to=user.email)
`,
  },
];
