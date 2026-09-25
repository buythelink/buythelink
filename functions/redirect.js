export async function onRequestGet(context) {
  try {
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response("Server configuration error", {
        status: 500
      });
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=current_url`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) {
      return new Response("Unable to retrieve current link", {
        status: 500
      });
    }

    const data = await response.json();

    if (!data || !data.length || !data[0].current_url) {
      return new Response("No link has been purchased yet", {
        status: 404
      });
    }

    const destination = String(data[0].current_url).trim();

    // Only allow normal web URLs
    if (!/^https?:\/\//i.test(destination)) {
      return new Response("Invalid destination URL", {
        status: 400
      });
    }

    return Response.redirect(destination, 302);

  } catch (error) {
    console.error("Redirect error:", error);

    return new Response("Redirect failed", {
      status: 500
    });
  }
}
