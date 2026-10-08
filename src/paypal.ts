import { GameError } from "./errors";

export interface PaypalEnv {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
}

interface TokenCache {
  token: string;
  exp: number;
}

let tokenCache: TokenCache | null = null;

export function paypalReady(env: PaypalEnv): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

export function paypalMode(env: PaypalEnv): "sandbox" | "live" {
  return env.PAYPAL_MODE === "live" ? "live" : "sandbox";
}

function baseUrl(env: PaypalEnv): string {
  return paypalMode(env) === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function accessToken(env: PaypalEnv): Promise<string> {
  if (!paypalReady(env)) throw new GameError("PayPal isn't configured.", 400);
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const key = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${baseUrl(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  if (!response.ok) {
    console.log(JSON.stringify({ event: "paypal_oauth_failed", status: response.status }));
    throw new GameError("PayPal refused the server login.", 502);
  }
  const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token) throw new GameError("PayPal returned no access token.", 502);
  tokenCache = {
    token: parsed.access_token,
    exp: Date.now() + (parsed.expires_in ?? 300) * 1000,
  };
  return parsed.access_token;
}

async function paypal<T>(env: PaypalEnv, path: string, init: { method: string; body?: string; requestId: string }): Promise<T> {
  const token = await accessToken(env);
  const response = await fetch(`${baseUrl(env)}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": init.requestId,
    },
    body: init.body,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `PayPal returned ${response.status}.`;
    try {
      const parsed = JSON.parse(text) as { message?: string; details?: { description?: string }[]; debug_id?: string };
      message = parsed.details?.[0]?.description || parsed.message || message;
      console.log(JSON.stringify({ event: "paypal_error", status: response.status, debugId: parsed.debug_id, path }));
    } catch {
      console.log(JSON.stringify({ event: "paypal_error", status: response.status, path }));
    }
    throw new GameError(message, 502);
  }
  return JSON.parse(text) as T;
}

export async function createAuthorizationOrder(env: PaypalEnv, offer: number, jobId: string, description: string): Promise<string> {
  const order = await paypal<{ id?: string }>(env, "/v2/checkout/orders", {
    method: "POST",
    requestId: `${jobId}:order`,
    body: JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: jobId,
          description: description.slice(0, 127),
          custom_id: jobId,
          amount: { currency_code: "USD", value: offer.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Burn Rate",
            shipping_preference: "NO_SHIPPING",
            user_action: "CONTINUE",
          },
        },
      },
    }),
  });
  if (!order.id) throw new GameError("PayPal created an order without an id.", 502);
  return order.id;
}

interface AuthorizedOrder {
  purchase_units?: { payments?: { authorizations?: { id?: string; status?: string }[] } }[];
}

export async function authorizeOrder(env: PaypalEnv, orderId: string, jobId: string): Promise<string> {
  const order = await paypal<AuthorizedOrder>(env, `/v2/checkout/orders/${orderId}/authorize`, {
    method: "POST",
    requestId: `${jobId}:authorize`,
    body: "{}",
  });
  const authorizationId = order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorizationId) throw new GameError("PayPal approved the order without an authorization.", 502);
  return authorizationId;
}

interface CaptureResult {
  id?: string;
  status?: string;
}

export async function captureAuthorization(env: PaypalEnv, authorizationId: string, amount: number, jobId: string): Promise<string> {
  const capture = await paypal<CaptureResult>(env, `/v2/payments/authorizations/${authorizationId}/capture`, {
    method: "POST",
    requestId: `${jobId}:capture`,
    body: JSON.stringify({
      amount: { currency_code: "USD", value: amount.toFixed(2) },
      final_capture: true,
      invoice_id: jobId.slice(0, 127),
      note_to_payer: "Burn Rate winning bid. The rest of the authorization is released.",
    }),
  });
  if (!capture.id) throw new GameError("PayPal captured the bid without a capture id.", 502);
  return capture.id;
}
