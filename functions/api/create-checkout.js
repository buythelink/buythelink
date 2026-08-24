export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const { name, email, url } = body;

    if (!name || !email || !url) {
      return new Response(
        JSON.stringify({ error: "Please complete all fields." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (!/^https?:\/\/.+/i.test(url)) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid website URL." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const amount = 1000; // $10.00 in cents

    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append(
      "line_items[0][price_data][currency]",
      "usd"
    );
    params.append(
      "line_items[0][price_data][product_data][name]",
      "BuyTheLink Ownership"
    );
    params.append(
      "line_items[0][price_data][product_data][description]",
      "Ownership of the BuyTheLink.com premium link"
    );
    params.append(
      "line_items[0][price_data][unit_amount]",
      amount.toString()
    );
    params.append("line_items[0][quantity]", "1");

    params.append("customer_email", email);

    params.append(
      "success_url",
      "https://buythelink.com/success.html"
    );

    params.append(
      "cancel_url",
      "https://buythelink.com/"
    );

    params.append("metadata[name]", name);
    params.append("metadata[email]", email);
    params.append("metadata[destination_url]", url);

    const response = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${context.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );

    const session = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: session.error?.message || "Stripe error"
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Something went wrong." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
