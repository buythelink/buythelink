export async function onRequestPost(context) {
  try {
    const contentType =
      context.request.headers.get("content-type") || "";

    let name = "";
    let email = "";
    let url = "";

    if (contentType.includes("application/json")) {
      const body = await context.request.json();

      name = String(body.name || "").trim();
      email = String(body.email || "").trim();
      url = String(body.url || "").trim();
    } else {
      const formData = await context.request.formData();

      name = String(formData.get("name") || "").trim();
      email = String(formData.get("email") || "").trim();
      url = String(formData.get("url") || "").trim();
    }

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

    // --------------------------------------------
    // Get LIVE price from Supabase
    // --------------------------------------------

    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    const priceResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=current_price`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!priceResponse.ok) {
      console.log(
        "Price lookup failed:",
        priceResponse.status,
        await priceResponse.text()
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

    const priceData = await priceResponse.json();

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

    const currentPrice = Number(
      priceData[0].current_price
    );

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
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

    // Stripe uses the smallest currency unit.
    // £12.50 becomes 1250 pence.

    const stripeAmount = Math.round(
      currentPrice * 100
    );

    // --------------------------------------------
    // Create Stripe Checkout Session
    // --------------------------------------------

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
      "gbp"
    );

    stripeParams.append(
      "line_items[0][price_data][unit_amount]",
      String(stripeAmount)
    );

    stripeParams.append(
      "line_items[0][price_data][product_data][name]",
      "BuyTheLink"
    );

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
          "Authorization":
            `Bearer ${context.env.STRIPE_SECRET_KEY}`,

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body: stripeParams
      }
    );

    const stripeData =
      await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.log(
        "Stripe error:",
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
      "Checkout error:",
      error
    );

    return new Response(
      JSON.stringify({
        error: String(error)
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
