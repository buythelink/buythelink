export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();

    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const url = String(formData.get("url") || "").trim();

    // Validate required fields
    if (!name || !email || !url) {
      return new Response(
        JSON.stringify({
          error: "Please complete all fields"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({
          error: "Please enter a valid email address"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Validate destination URL
    let destinationUrl;

    try {
      destinationUrl = new URL(url);

      if (
        destinationUrl.protocol !== "http:" &&
        destinationUrl.protocol !== "https:"
      ) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return new Response(
        JSON.stringify({
          error: "Please enter a valid website URL"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // --------------------------------------------------
    // Get LIVE price from Supabase
    // --------------------------------------------------

    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    const supabaseResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=current_price`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!supabaseResponse.ok) {
      console.log(
        "Supabase price lookup failed:",
        supabaseResponse.status,
        await supabaseResponse.text()
      );

      return new Response(
        JSON.stringify({
          error: "Unable to get current price"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const priceData = await supabaseResponse.json();

    if (!priceData.length) {
      return new Response(
        JSON.stringify({
          error: "Current price not found"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const currentPrice = Number(priceData[0].current_price);

    if (!Number.isInteger(currentPrice) || currentPrice <= 0) {
      return new Response(
        JSON.stringify({
          error: "Invalid current price"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // --------------------------------------------------
    // Create Stripe Checkout Session
    // --------------------------------------------------

    const stripeKey = context.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      return new Response(
        JSON.stringify({
          error: "Stripe secret key is not configured"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const stripeParams = new URLSearchParams();

    stripeParams.append(
      "mode",
      "payment"
    );

    stripeParams.append(
      "success_url",
      "https://buythelink.com/?success=true"
    );

    stripeParams.append(
      "cancel_url",
      "https://buythelink.com/?cancelled=true"
    );

    stripeParams.append(
      "customer_email",
      email
    );

    stripeParams.append(
      "line_items[0][quantity]",
      "1"
    );

    stripeParams.append(
      "line_items[0][price_data][currency]",
      "usd"
    );

    stripeParams.append(
      "line_items[0][price_data][product_data][name]",
      "BuyTheLink"
    );

    stripeParams.append(
      "line_items[0][price_data][unit_amount]",
      String(currentPrice)
    );

    // Metadata that will arrive in checkout.session.completed
    stripeParams.append(
      "metadata[name]",
      name
    );

    stripeParams.append(
      "metadata[email]",
      email
    );

    stripeParams.append(
      "metadata[destination_url]",
      destinationUrl.toString()
    );

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: stripeParams
      }
    );

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.log(
        "Stripe checkout creation failed:",
        stripeData
      );

      return new Response(
        JSON.stringify({
          error:
            stripeData.error?.message ||
            "Unable to create Stripe checkout"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        url: stripeData.url
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
      "Create checkout error:",
      error
    );

    return new Response(
      JSON.stringify({
        error: "Internal server error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
