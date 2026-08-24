export async function onRequestGet(context) {
  try {
    const response = await fetch(
      `${context.env.SUPABASE_URL}/rest/v1/site_state?id=eq.1&select=current_url`,
      {
        headers: {
          "apikey": context.env.SUPABASE_SECRET_KEY,
          "Authorization": `Bearer ${context.env.SUPABASE_SECRET_KEY}`,
          "Accept-Profile": "public"
        }
      }
    );

    if (!response.ok) {
      return new Response("Unable to find current link", {
        status: 500
      });
    }

    const data = await response.json();

    if (!data.length || !data[0].current_url) {
      return new Response("No link has been purchased yet.", {
        status: 404
      });
    }

    const destination = data[0].current_url;

    // Only allow normal HTTP/HTTPS destinations.
    const url = new URL(destination);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return new Response("Invalid destination", {
        status: 400
      });
    }

    return Response.redirect(url.toString(), 302);

  } catch (error) {
    console.log("Redirect error:", error);

    return new Response("Redirect error", {
      status: 500
    });
  }
}
