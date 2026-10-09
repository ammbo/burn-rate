import {
  CheckoutPaymentIntent,
  PaypalClient,
  PaypalError,
  PayPalExperienceUserAction,
  PayPalWalletContextShippingPreference,
  type Error as PaypalErrorBody,
} from "paypal";
import { GameError } from "./errors";

export interface PaypalEnv {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MODE?: string;
}

let cachedClient: { key: string; client: PaypalClient } | null = null;

export function paypalReady(env: PaypalEnv): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

export function paypalMode(env: PaypalEnv): "sandbox" | "live" {
  return env.PAYPAL_MODE === "live" ? "live" : "sandbox";
}

function baseUrl(env: PaypalEnv): string {
  return paypalMode(env) === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

// The SDK declares only a sandbox environment, so live is a baseUrl override.
// The client is kept per credential set because it owns the OAuth token cache.
function client(env: PaypalEnv): PaypalClient {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new GameError("PayPal isn't configured.", 400);
  const key = `${baseUrl(env)}|${env.PAYPAL_CLIENT_ID}|${env.PAYPAL_CLIENT_SECRET}`;
  if (cachedClient?.key !== key) {
    cachedClient = {
      key,
      client: new PaypalClient({
        oauth2: { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET },
        serverOptions: { baseUrl: baseUrl(env) },
        // The SDK captures fetch at construction; resolve the global per call instead.
        fetch: (input, init) => fetch(input, init),
      }),
    };
  }
  return cachedClient.client;
}

function toGameError(err: unknown): unknown {
  if (!(err instanceof PaypalError)) return err;
  const path = new URL(err.uri).pathname;
  if (err.kind === "auth") {
    const status = err.cause instanceof PaypalError && err.cause.kind === "api" ? err.cause.status : undefined;
    console.log(JSON.stringify({ event: "paypal_oauth_failed", status }));
    return new GameError("PayPal refused the server login.", 502);
  }
  if (err.kind === "api") {
    const body = "body" in err.payload ? (err.payload.body as Partial<PaypalErrorBody> | undefined) : undefined;
    console.log(JSON.stringify({ event: "paypal_error", status: err.status, debugId: body?.debugId, path }));
    return new GameError(body?.details?.[0]?.description || body?.message || `PayPal returned ${err.status}.`, 502);
  }
  console.log(JSON.stringify({ event: "paypal_error", kind: err.kind, path }));
  return new GameError("PayPal could not be reached.", 502);
}

async function paypal<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    throw toGameError(err);
  }
}

export async function createAuthorizationOrder(env: PaypalEnv, offer: number, jobId: string, description: string): Promise<string> {
  const order = await paypal(() =>
    client(env).orders.createOrder({
      payPalRequestId: `${jobId}:order`,
      prefer: "return=representation",
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          {
            referenceId: jobId,
            description: description.slice(0, 127),
            customId: jobId,
            amount: { currencyCode: "USD", value: offer.toFixed(2) },
          },
        ],
        paymentSource: {
          paypal: {
            experienceContext: {
              brandName: "Burn Rate",
              shippingPreference: PayPalWalletContextShippingPreference.NoShipping,
              userAction: PayPalExperienceUserAction.Continue,
            },
          },
        },
      },
    }),
  );
  if (!order.id) throw new GameError("PayPal created an order without an id.", 502);
  return order.id;
}

export async function authorizeOrder(env: PaypalEnv, orderId: string, jobId: string): Promise<string> {
  const order = await paypal(() =>
    client(env).orders.authorizeOrder({
      id: orderId,
      payPalRequestId: `${jobId}:authorize`,
      prefer: "return=representation",
      body: {},
    }),
  );
  const authorizationId = order.purchaseUnits?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorizationId) throw new GameError("PayPal approved the order without an authorization.", 502);
  return authorizationId;
}

export async function captureAuthorization(env: PaypalEnv, authorizationId: string, amount: number, jobId: string): Promise<string> {
  const capture = await paypal(() =>
    client(env).payments.captureAuthorizedPayment({
      authorizationId,
      payPalRequestId: `${jobId}:capture`,
      prefer: "return=representation",
      body: {
        amount: { currencyCode: "USD", value: amount.toFixed(2) },
        finalCapture: true,
        invoiceId: jobId.slice(0, 127),
        noteToPayer: "Burn Rate winning bid. The rest of the authorization is released.",
      },
    }),
  );
  if (!capture.id) throw new GameError("PayPal captured the bid without a capture id.", 502);
  return capture.id;
}
