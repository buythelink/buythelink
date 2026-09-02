export async function onRequestPost(context) {
  try {

    // --------------------------------------------
    // Environment variables
    // --------------------------------------------

    const stripeWebhookSecret =
      context.env.STRIPE_WEBHOOK_SECRET;

    const supabaseUrl =
      context.env.SUPABASE_URL;

    const supabaseKey =
      context.env.SUPABASE_SECRET_KEY;

    if (
      !stripeWebhookSecret ||
      !supabaseUrl ||
      !supabaseKey
    ) {
      console.log(
        "Missing webhook environment variables"
      );

      return new Response(
        "Server configuration error",
        {
          status: 500
        }
      );
    }

    // --------------------------------------------
    // Read Stripe request
    // --------------------------------------------

    const payload =
      await context.request.text();

    const signature =
      context.request.headers.get(
        "Stripe-Signature"
      );

    if (!signature) {
      return new Response(
        "Missing Stripe signature",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Verify Stripe signature
    // --------------------------------------------

    const signatureParts =
      signature.split(",");

    let timestamp = null;
    const signatures = [];

    for (const part of signatureParts) {

      const [key, value] =
        part.split("=");

      if (key === "t") {
        timestamp = value;
      }

      if (key === "v1") {
        signatures.push(value);
      }
    }

    if (!timestamp || signatures.length === 0) {
      return new Response(
        "Invalid Stripe signature",
        {
          status: 400
        }
      );
    }

    const timestampNumber =
      Number(timestamp);

    if (!Number.isFinite(timestampNumber)) {
      return new Response(
        "Invalid Stripe timestamp",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // 5 minute replay protection
    // --------------------------------------------

    const currentUnixTime =
      Math.floor(Date.now() / 1000);

    if (
      Math.abs(
        currentUnixTime -
        timestampNumber
      ) > 300
    ) {
      return new Response(
        "Webhook timestamp too old",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // HMAC SHA-256
    // --------------------------------------------

    const signedPayload =
      `${timestamp}.${payload}`;

    const encoder =
      new TextEncoder();

    const keyData =
      encoder.encode(
        stripeWebhookSecret
      );

    const cryptoKey =
      await crypto.subtle.importKey(
        "raw",
        keyData,
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

    const signatureBuffer =
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(
          signedPayload
        )
      );

    const generatedSignature =
      Array.from(
        new Uint8Array(
          signatureBuffer
        )
      )
        .map(
          byte =>
            byte
              .toString(16)
              .padStart(2, "0")
        )
        .join("");

    // --------------------------------------------
    // Compare signatures
    // --------------------------------------------

    const validSignature =
      signatures.some(
        signatureValue =>
          signatureValue ===
          generatedSignature
      );

    if (!validSignature) {
      console.log(
        "Invalid Stripe signature"
      );

      return new Response(
        "Invalid signature",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Parse event
    // --------------------------------------------

    let event;

    try {
      event =
        JSON.parse(payload);
    } catch {
      return new Response(
        "Invalid JSON",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // We only care about completed checkout
    // --------------------------------------------

    if (
      event.type !==
      "checkout.session.completed"
    ) {
      return new Response(
        JSON.stringify({
          received: true
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

    const session =
      event.data?.object;

    if (!session) {
      return new Response(
        "Missing checkout session",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Make sure payment was actually successful
    // --------------------------------------------

    if (
      session.payment_status !==
      "paid"
    ) {
      console.log(
        "Checkout session not paid:",
        session.id
      );

      return new Response(
        JSON.stringify({
          received: true,
          ignored: "Payment not completed"
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

    // --------------------------------------------
    // Read metadata
    // --------------------------------------------

    const metadata =
      session.metadata || {};

    const ownerName =
      String(
        metadata.name || ""
      ).trim();

    const ownerEmail =
      String(
        metadata.email || ""
      ).trim();

    const destinationUrl =
      String(
        metadata.destination_url || ""
      ).trim();

    if (
      !ownerName ||
      !ownerEmail ||
      !destinationUrl
    ) {
      console.log(
        "Missing checkout metadata:",
        metadata
      );

      return new Response(
        "Missing required metadata",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Get payment amount
    //
    // Stripe amount_total is cents.
    // --------------------------------------------

    const stripeAmount =
      Number(
        session.amount_total
      );

    if (
      !Number.isInteger(
        stripeAmount
      ) ||
      stripeAmount <= 0
    ) {
      return new Response(
        "Invalid payment amount",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Currency must be USD
    // --------------------------------------------

    const currency =
      String(
        session.currency || ""
      ).toLowerCase();

    if (currency !== "usd") {
      console.log(
        "Unexpected currency:",
        currency
      );

      return new Response(
        "Invalid currency",
        {
          status: 400
        }
      );
    }

    // --------------------------------------------
    // Get current site state
    // --------------------------------------------

    const stateResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=*`,
        {
          method: "GET",
          headers: {
            "apikey": supabaseKey,
            "Authorization":
              `Bearer ${supabaseKey}`,
            "Accept":
              "application/json"
          }
        }
      );

    const stateText =
      await stateResponse.text();

    if (!stateResponse.ok) {

      console.log(
        "Supabase state lookup failed:",
        stateResponse.status,
        stateText
      );

      return new Response(
        "Unable to get site state",
        {
          status: 500
        }
      );
    }

    const stateData =
      JSON.parse(stateText);

    if (
      !Array.isArray(stateData) ||
      stateData.length === 0
    ) {
      return new Response(
        "Site state not found",
        {
          status: 500
        }
      );
    }

    const state =
      stateData[0];

    const currentPrice =
      Number(
        state.current_price
      );

    if (
      !Number.isInteger(
        currentPrice
      ) ||
      currentPrice <= 0
    ) {
      return new Response(
        "Invalid current price",
        {
          status: 500
        }
      );
    }

    // --------------------------------------------
    // Make sure Stripe charged current price
    // --------------------------------------------

    if (
      stripeAmount !==
      currentPrice
    ) {

      console.log(
        "Price mismatch:",
        {
          stripeAmount,
          currentPrice
        }
      );

      return new Response(
        "Price mismatch",
        {
          status: 409
        }
      );
    }

    // --------------------------------------------
    // Check whether this sale already exists
    // --------------------------------------------

    const saleCheckResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/sales?stripe_payment_id=eq.${encodeURIComponent(session.id)}&select=id`,
        {
          method: "GET",
          headers: {
            "apikey": supabaseKey,
            "Authorization":
              `Bearer ${supabaseKey}`,
            "Accept":
              "application/json"
          }
        }
      );

    if (saleCheckResponse.ok) {

      const existingSales =
        await saleCheckResponse.json();

      if (
        Array.isArray(existingSales) &&
        existingSales.length > 0
      ) {

        console.log(
          "Sale already processed:",
          session.id
        );

        return new Response(
          JSON.stringify({
            received: true,
            already_processed: true
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
    }

    // --------------------------------------------
    // Calculate next price
    //
    // Increase by 25%.
    //
    // Example:
    // $12.50 -> $15.63
    // $15.63 -> $19.54
    // --------------------------------------------

    const newPrice =
      Math.ceil(
        currentPrice * 1.25
      );

    const saleNumber =
      Number(
        state.sale_count || 0
      ) + 1;

    const currentRevenue =
      Number(
        state.total_revenue || 0
      );

    const newTotalRevenue =
      currentRevenue +
      stripeAmount;

    // --------------------------------------------
    // Insert sale
    // --------------------------------------------

    const saleResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/sales`,
        {
          method: "POST",

          headers: {
            "apikey": supabaseKey,
            "Authorization":
              `Bearer ${supabaseKey}`,
            "Content-Type":
              "application/json",
            "Prefer":
              "return=minimal"
          },

          body: JSON.stringify({
            amount: stripeAmount,
            currency: "usd",
            name: ownerName,
            email: ownerEmail,
            destination_url:
              destinationUrl,
            stripe_payment_id:
              session.id
          })
        }
      );

    if (!saleResponse.ok) {

      const saleError =
        await saleResponse.text();

      console.log(
        "Sale insert failed:",
        saleError
      );

      return new Response(
        "Unable to record sale",
        {
          status: 500
        }
      );
    }

    // --------------------------------------------
    // Update site state
    // --------------------------------------------

    const updateResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/site_state?id=eq.1`,
        {
          method: "PATCH",

          headers: {
            "apikey": supabaseKey,
            "Authorization":
              `Bearer ${supabaseKey}`,
            "Content-Type":
              "application/json",
            "Prefer":
              "return=minimal"
          },

          body: JSON.stringify({

            current_price:
              newPrice,

            current_owner:
              ownerName,

            current_email:
              ownerEmail,

            current_url:
              destinationUrl,

            sale_count:
              saleNumber,

            total_revenue:
              newTotalRevenue,

            updated_at:
              new Date().toISOString()

          })
        }
      );

    if (!updateResponse.ok) {

      const updateError =
        await updateResponse.text();

      console.log(
        "Site state update failed:",
        updateError
      );

      return new Response(
        "Sale recorded but site state update failed",
        {
          status: 500
        }
      );
    }

    // --------------------------------------------
    // Success
    // --------------------------------------------

    console.log(
      "SALE COMPLETED",
      {
        sale: saleNumber,
        owner: ownerName,
        amount: stripeAmount,
        oldPrice: currentPrice,
        newPrice: newPrice
      }
    );

    return new Response(
      JSON.stringify({

        received: true,

        sale_number:
          saleNumber,

        amount:
          stripeAmount,

        currency:
          "usd",

        new_price:
          newPrice,

        new_price_display:
          `$${(
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
      JSON.stringify({
        error:
          error?.message ||
          "Server error"
      }),
      {
        status: 500,

        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );
  }
  }
