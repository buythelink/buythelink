export async function onRequestPost(context) {
  const signature = context.request.headers.get("Stripe-Signature");
  const rawBody = await context.request.text();

  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  try {
    // Verify that this request genuinely came from Stripe
    const parts = Object.fromEntries(
      signature.split(",").map(part => {
        const [key, value] = part.split("=");
        return [key, value];
      })
    );

    const timestamp = parts.t;
    const receivedSignature = parts.v1;

    if (!timestamp || !receivedSignature) {
      return new Response("Invalid Stripe signature", { status: 400 });
    }

    // Reject very old webhook requests
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));

    if (age > 300) {
      return new Response("Webhook timestamp too old", { status: 400 });
    }

    const signedPayload = `${timestamp}.${rawBody}`;

    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(context.env.STRIPE_WEBHOOK_SECRET),
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

    if (expectedSignature !== receivedSignature) {
      return new Response("Invalid Stripe signature", { status: 400 });
    }

    // Parse the Stripe event
    const event = JSON.parse(rawBody);

    // We only care about completed BuyTheLink checkouts
    if (event.type !== "checkout.session.completed") {
      return new Response("Event ignored", { status: 200 });
    }

    const session = event.data.object;

    const ownerName = session.metadata?.name;
    const ownerEmail = session.metadata?.email;
    const destinationUrl = session.metadata?.destination_url;

    const stripePaymentId = session.id;
    const amountPaid = session.amount_total;
    const currency = session.currency || "usd";

    if (
      !ownerName ||
      !ownerEmail ||
      !destinationUrl ||
      !amountPaid ||
      !stripePaymentId
    ) {
      return new Response("Missing purchase information", {
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

    // Check whether Stripe has already sent this event
    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/sales?stripe_payment_id=eq.${encodeURIComponent(stripePaymentId)}&select=id`,
      {
        headers
      }
    );

    const existingSales = await existingResponse.json();

    if (existingSales.length > 0) {
      return new Response("Already processed", { status: 200 });
    }

    // Get the current BuyTheLink state
    const stateResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=*`,
      {
        headers
      }
    );

    if (!stateResponse.ok) {
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

    // Make sure the buyer paid the current advertised price
    if (amountPaid !== state.current_price) {
      return new Response("Incorrect payment amount", {
        status: 400
      });
    }

    const saleNumber = state.sale_count + 1;

    // Increase the price by 25%
    const newPrice = Math.ceil(amountPaid * 1.25);

    // Record the sale
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
          amount: amountPaid,
          currency: currency,
          stripe_payment_id: stripePaymentId
        })
      }
    );

    if (!saleResponse.ok) {
      return new Response("Unable to record sale", {
        status: 500
      });
    }

    // Update the current owner, destination and price
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
          total_revenue: state.total_revenue + amountPaid,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!updateResponse.ok) {
      return new Response("Sale recorded but site state update failed", {
        status: 500
      });
    }

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
    console.error(error);

    return new Response("Webhook processing failed", {
      status: 500
    });
  }
}
