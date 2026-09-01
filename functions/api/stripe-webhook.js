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

    const timestampAge =
      Math.floor(Date.now() / 1000) - Number(timestamp);

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
      ["verify"]
    );

    for (const signatureValue of signatures) {
      try {
        const signatureBytes = new Uint8Array(
          signatureValue.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );

        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          signatureBytes,
          encoder.encode(signedPayload)
        );

        if (valid) {
          return true;
        }
      } catch (error) {
        console.log("Signature verification error:", error);
      }
    }

    return false;
  }

  try {

    // --------------------------------------------------
    // 0. Verify Stripe webhook signature
    // --------------------------------------------------

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

    // --------------------------------------------------
    // Read Stripe event
    // --------------------------------------------------

    const event = JSON.parse(body);

    if (event.type !== "checkout.session.completed") {
      return new Response("Event ignored", {
        status: 200
      });
    }

    const session = event.data.object;

    // Only process genuinely paid sessions
    if (session.payment_status !== "paid") {
      return new Response("Payment not completed", {
        status: 400
      });
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
    // 1. Check whether this sale already exists
    // --------------------------------------------------

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/sales?stripe_payment_id=eq.${encodeURIComponent(session.id)}&select=*`,
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

    const alreadyProcessed = existingSales.length > 0;

    let recordedSale = null;

    if (alreadyProcessed) {
      recordedSale = existingSales[0];

      console.log(
        `Sale ${session.id} already recorded. Checking state update.`
      );
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
    // 3. Check whether the state has already been updated
    // --------------------------------------------------

    /*
      If the current price is already higher than the amount
      paid for this session, this sale has already advanced
      the BuyTheLink state.

      Do NOT update it again.
    */

    if (alreadyProcessed &&
        state.current_price > session.amount_total) {

      console.log(
        "Sale already processed and site state already advanced."
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "Already processed"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // --------------------------------------------------
    // 4. Verify the amount paid
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
    // 5. Determine sale number and next price
    // --------------------------------------------------

    let saleNumber;
    let newPrice;

    if (alreadyProcessed) {

      /*
        The sale was recorded during the previous attempt,
        but the state update failed.

        Use the existing sale number rather than creating
        another sale.
      */

      saleNumber = recordedSale.sale_number;

      newPrice = Math.ceil(
        state.current_price * 1.25
      );

      console.log(
        `Retrying state update for existing sale #${saleNumber}`
      );

    } else {

      saleNumber = state.sale_count + 1;

      newPrice = Math.ceil(
        state.current_price * 1.25
      );

    }

    // --------------------------------------------------
    // 6. Record the sale if it doesn't already exist
    // --------------------------------------------------

    if (!alreadyProcessed) {

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

      console.log(
        `Sale #${saleNumber} recorded successfully.`
      );
    }

    // --------------------------------------------------
    // 7. Update current BuyTheLink ownership
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

    // --------------------------------------------------
    // 8. Complete
    // --------------------------------------------------

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

    console.log(
      "Webhook error:",
      error
    );

    return new Response(
      "Webhook processing failed",
      {
        status: 500
      }
    );
  }
}
