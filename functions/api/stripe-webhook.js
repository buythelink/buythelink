export async function onRequestPost(context) {
async function verifyStripeSignature(body, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const parts = signature.split(",");

  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const [key, value] = part.split("=");

    if (key === "t") {
      timestamp = value;
    }

    if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  // Reject old/replayed webhook requests
  const timestampAge = Math.floor(Date.now() / 1000) - Number(timestamp);

  if (Math.abs(timestampAge) > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${body}`;

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );

  const expectedSignature = Array.from(
    new Uint8Array(signatureBytes)
  )
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some(
    signature => signature === expectedSignature
  );
}

  try {
    const body = await context.request.text();
const stripeSignature =
  context.request.headers.get("Stripe-Signature");

const isValid = await verifyStripeSignature(
  body,
  stripeSignature,
  context.env.STRIPE_WEBHOOK_SECRET
);

if (!isValid) {
  return new Response("Invalid Stripe signature", {
    status: 400
  });
}

    
    // For this MVP, Stripe has already delivered the event
    // to this private server endpoint.
    const event = JSON.parse(body);

    if (event.type !== "checkout.session.completed") {
      return new Response("Event ignored", { status: 200 });
    }

    const session = event.data.object;

    // Only process a genuinely paid Checkout Session
    if (session.payment_status !== "paid") {
      return new Response("Payment not completed", { status: 400 });
    }

    const metadata = session.metadata || {};

    const ownerName = metadata.name;
    const ownerEmail = metadata.email;
    const destinationUrl = metadata.destination_url;

    if (!ownerName || !ownerEmail || !destinationUrl) {
      console.log("Missing metadata:", metadata);

      return new Response("Missing purchase metadata", {
        status: 400
      });
    }

    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    };

    // --------------------------------------------------
    // 1. Prevent duplicate processing
    // --------------------------------------------------

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/sales?stripe_payment_id=eq.${encodeURIComponent(session.id)}&select=id`,
      {
        headers
      }
    );

    if (!existingResponse.ok) {
      console.log(
        "Existing-sale check failed:",
        existingResponse.status,
        await existingResponse.text()
      );

      return new Response("Database check failed", {
        status: 500
      });
    }

    const existingSales = await existingResponse.json();

    if (existingSales.length > 0) {
      return new Response("Already processed", {
        status: 200
      });
    }

    // --------------------------------------------------
    // 2. Get current BuyTheLink state
    // --------------------------------------------------

    const stateResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=*`,
      {
        headers
      }
    );

    if (!stateResponse.ok) {
      console.log(
        "State lookup failed:",
        stateResponse.status,
        await stateResponse.text()
      );

      return new Response("Unable to read site state", {
        status: 500
      });
    }

    const states = await stateResponse.json();

    if (!states.length) {
      return new Response("Site state not found", {
        status: 500
      });
    }

    const state = states[0];

    // --------------------------------------------------
    // 3. Verify the amount paid
    // --------------------------------------------------

    if (session.amount_total !== state.current_price) {
      console.log(
        "Incorrect amount:",
        session.amount_total,
        "expected:",
        state.current_price
      );

      return new Response("Incorrect payment amount", {
        status: 400
      });
    }

    // --------------------------------------------------
    // 4. Calculate the next price
    // --------------------------------------------------

    const saleNumber = state.sale_count + 1;

    // Increase by 25%
    const newPrice = Math.ceil(
      state.current_price * 1.25
    );

    // --------------------------------------------------
    // 5. Record the sale
    // --------------------------------------------------

    const saleResponse = await fetch(
      `${supabaseUrl}/rest/v1/sales`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          sale_number: saleNumber,
          owner_name: ownerName,
          owner_email: ownerEmail,
          destination_url: destinationUrl,
          amount: session.amount_total,
          currency: session.currency || "usd",
          stripe_payment_id: session.id
        })
      }
    );

    if (!saleResponse.ok) {
      console.log(
        "Sale insert failed:",
        saleResponse.status,
        await saleResponse.text()
      );

      return new Response("Unable to record sale", {
        status: 500
      });
    }

    // --------------------------------------------------
    // 6. Update current BuyTheLink ownership
    // --------------------------------------------------

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          current_price: newPrice,
          current_owner: ownerName,
          current_email: ownerEmail,
          current_url: destinationUrl,
          sale_count: saleNumber,
          total_revenue:
            state.total_revenue + session.amount_total,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateResponse.ok) {
      console.log(
        "State update failed:",
        updateResponse.status,
        await updateResponse.text()
      );

      return new Response(
        "Sale recorded but state update failed",
        {
          status: 500
        }
      );
    }

    console.log(
      `BuyTheLink sale #${saleNumber} completed. New price: ${newPrice}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        sale_number: saleNumber,
        new_price: newPrice
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (error) {
    console.log("Webhook error:", error);

    return new Response("Webhook processing failed", {
      status: 500
    });
  }
}
