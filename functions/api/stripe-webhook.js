export async function onRequestPost(context) {

  // ==================================================
  // Verify Stripe webhook signature
  // ==================================================

  async function verifyStripeSignature(
    body,
    signature,
    secret
  ) {

    if (!signature || !secret) {
      return false;
    }

    const parts =
      signature.split(",");

    let timestamp = null;
    const signatures = [];

    for (const part of parts) {

      const [key, value] =
        part.split("=");

      if (key === "t") {
        timestamp = value;
      }

      if (key === "v1") {
        signatures.push(value);
      }
    }

    if (
      !timestamp ||
      signatures.length === 0
    ) {
      return false;
    }

    const timestampAge =
      Math.floor(Date.now() / 1000) -
      Number(timestamp);

    // Reject signatures older than 5 minutes

    if (
      Math.abs(timestampAge) > 300
    ) {
      return false;
    }

    const signedPayload =
      `${timestamp}.${body}`;

    const encoder =
      new TextEncoder();

    const key =
      await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["verify"]
      );

    for (
      const signatureValue of signatures
    ) {

      try {

        const signatureBytes =
          new Uint8Array(
            signatureValue
              .match(/.{1,2}/g)
              .map(byte =>
                parseInt(byte, 16)
              )
          );

        const valid =
          await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            encoder.encode(
              signedPayload
            )
          );

        if (valid) {
          return true;
        }

      } catch (error) {

        console.log(
          "Signature verification error:",
          error
        );
      }
    }

    return false;
  }


  try {

    // ==================================================
    // 0. Verify Stripe signature
    // ==================================================

    const body =
      await context.request.text();

    const stripeSignature =
      context.request.headers.get(
        "Stripe-Signature"
      );

    const isValid =
      await verifyStripeSignature(
        body,
        stripeSignature,
        context.env.STRIPE_WEBHOOK_SECRET
      );

    if (!isValid) {

      return new Response(
        "Invalid Stripe signature",
        {
          status: 400
        }
      );
    }


    // ==================================================
    // 1. Read Stripe event
    // ==================================================

    const event =
      JSON.parse(body);


    // Only process completed Checkout Sessions

    if (
      event.type !==
      "checkout.session.completed"
    ) {

      return new Response(
        "Event ignored",
        {
          status: 200
        }
      );
    }


    const session =
      event.data.object;


    // ==================================================
    // 2. Make sure payment was completed
    // ==================================================

    if (
      session.payment_status !==
      "paid"
    ) {

      return new Response(
        "Payment not completed",
        {
          status: 400
        }
      );
    }


    // ==================================================
    // 3. Get metadata
    // ==================================================

    const metadata =
      session.metadata || {};

    const ownerName =
      metadata.name;

    const ownerEmail =
      metadata.email;

    const destinationUrl =
      metadata.destination_url;


    if (
      !ownerName ||
      !ownerEmail ||
      !destinationUrl
    ) {

      console.log(
        "Missing metadata:",
        metadata
      );

      return new Response(
        "Missing purchase metadata",
        {
          status: 400
        }
      );
    }


    // ==================================================
    // 4. Supabase connection
    // ==================================================

    const supabaseUrl =
      context.env.SUPABASE_URL;

    const supabaseKey =
      context.env.SUPABASE_SECRET_KEY;

    const headers = {

      "apikey":
        supabaseKey,

      "Authorization":
        `Bearer ${supabaseKey}`,

      "Content-Type":
        "application/json"
    };


    // ==================================================
    // 5. Check whether sale already exists
    // ==================================================

    const existingResponse =
      await fetch(
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

      return new Response(
        "Database check failed",
        {
          status: 500
        }
      );
    }


    const existingSales =
      await existingResponse.json();

    const alreadyProcessed =
      existingSales.length > 0;

    let recordedSale = null;


    if (alreadyProcessed) {

      recordedSale =
        existingSales[0];

      console.log(
        `Sale ${session.id} already exists.`
      );
    }


    // ==================================================
    // 6. Get current site state
    // ==================================================

    const stateResponse =
      await fetch(
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

      return new Response(
        "Unable to read site state",
        {
          status: 500
        }
      );
    }


    const states =
      await stateResponse.json();


    if (!states.length) {

      return new Response(
        "Site state not found",
        {
          status: 500
        }
      );
    }


    const state =
      states[0];


    // ==================================================
    // 7. Price handling
    //
    // IMPORTANT:
    //
    // current_price is stored in PENCE.
    //
    // Example:
    //
    // 1250 = £12.50
    // 1563 = £15.63
    //
    // Stripe also uses pence.
    // ==================================================

    const currentPrice =
      Number(state.current_price);

    const stripeAmount =
      Number(session.amount_total);


    if (
      !Number.isInteger(currentPrice) ||
      currentPrice <= 0
    ) {

      console.log(
        "Invalid current price:",
        currentPrice
      );

      return new Response(
        "Invalid current price",
        {
          status: 500
        }
      );
    }


    // ==================================================
    // 8. Check whether state was already updated
    // ==================================================

    /*
      If the sale exists and the current price
      has already moved above the amount paid,
      the webhook has already completed.

      Do not process it again.
    */

    if (
      alreadyProcessed &&
      currentPrice > stripeAmount
    ) {

      console.log(
        "Sale already processed and state already advanced."
      );

      return new Response(
        JSON.stringify({

          success:
            true,

          message:
            "Already processed"

        }),
        {
          status: 200,

          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );
    }


    // ==================================================
    // 9. Verify payment amount
    // ==================================================

    if (
      stripeAmount !==
      currentPrice
    ) {

      console.log(
        "Incorrect payment amount:",
        stripeAmount,

        "expected:",
        currentPrice
      );

      return new Response(
        "Incorrect payment amount",
        {
          status: 400
        }
      );
    }


    // ==================================================
    // 10. Determine sale number
    //     and next price
    // ==================================================

    let saleNumber;
    let newPrice;


    if (alreadyProcessed) {

      /*
        Sale exists but site state wasn't
        successfully updated.

        Re-use the existing sale number.
      */

      saleNumber =
        Number(
          recordedSale.sale_number
        );

      newPrice =
        Math.ceil(
          currentPrice * 1.25
        );

      console.log(
        `Retrying state update for sale #${saleNumber}`
      );

    } else {

      saleNumber =
        Number(
          state.sale_count || 0
        ) + 1;

      newPrice =
        Math.ceil(
          currentPrice * 1.25
        );

      console.log(
        `Processing new sale #${saleNumber}`
      );
    }


    // ==================================================
    // 11. Record sale
    // ==================================================

    if (!alreadyProcessed) {

      const saleResponse =
        await fetch(
          `${supabaseUrl}/rest/v1/sales`,
          {
            method: "POST",

            headers: {
              ...headers,

              "Prefer":
                "return=minimal"
            },

            body: JSON.stringify({

              sale_number:
                saleNumber,

              owner_name:
                ownerName,

              owner_email:
                ownerEmail,

              destination_url:
                destinationUrl,

              /*
                Store the amount in pence,
                matching current_price.
              */

              amount:
                stripeAmount,

              currency:
                session.currency ||
                "gbp",

              stripe_payment_id:
                session.id
            })
          }
        );


      if (!saleResponse.ok) {

        console.log(
          "Sale insert failed:",
          saleResponse.status,
          await saleResponse.text()
        );

        return new Response(
          "Unable to record sale",
          {
            status: 500
          }
        );
      }


      console.log(
        `Sale #${saleNumber} recorded successfully.`
      );
    }


    // ==================================================
    // 12. Update site state
    // ==================================================

    /*
      total_revenue is also stored in pence.

      Example:

      £12.50 + £10.00
      = 1250 + 1000
      = 2250
    */

    const newTotalRevenue =
      Number(
        state.total_revenue || 0
      ) +
      stripeAmount;


    const updateResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/site_state?id=eq.1`,
        {
          method: "PATCH",

          headers: {
            ...headers,

            "Prefer":
              "return=minimal"
          },

          body: JSON.stringify({

            current_price:
              Number(newPrice),

            current_owner:
              ownerName,

            current_email:
              ownerEmail,

            current_url:
              destinationUrl,

            sale_count:
              Number(saleNumber),

            total_revenue:
              Number(newTotalRevenue),

            updated_at:
              new Date().toISOString()
          })
        }
      );


    // ==================================================
    // 13. Check update
    // ==================================================

    if (!updateResponse.ok) {

      const updateError =
        await updateResponse.text();

      console.log(
        "State update failed:",
        updateResponse.status,
        updateError
      );

      return new Response(
        `State update failed: ${updateResponse.status} ${updateError}`,
        {
          status: 500
        }
      );
    }


    // ==================================================
    // 14. Complete
    // ==================================================

    console.log(
      `BuyTheLink sale #${saleNumber} completed.`
    );

    console.log(
      `Old price: ${currentPrice} pence`
    );

    console.log(
      `New price: ${newPrice} pence`
    );

    console.log(
      `New price: £${(
        newPrice / 100
      ).toFixed(2)}`
    );


    return new Response(
      JSON.stringify({

        success:
          true,

        sale_number:
          saleNumber,

        old_price:
          currentPrice,

        new_price:
          newPrice,

        new_price_display:
          `£${(
            newPrice / 100
          ).toFixed(2)}`

      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json"
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
