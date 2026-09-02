export async function onRequestGet(context) {
  try {
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({
          error: "Supabase environment variables are missing"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/site_state?id=eq.1&select=owner_name,owner_email,destination_url,sale_count`,
      {
        method: "GET",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.log(
        "Owner lookup failed:",
        response.status,
        errorText
      );

      return new Response(
        JSON.stringify({
          error: "Unable to get current owner"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Owner not found"
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const owner = data[0];

    return new Response(
      JSON.stringify({
        name: owner.owner_name || "Nobody yet",
        email: owner.owner_email || "",
        url: owner.destination_url || "",
        sale_count: Number(owner.sale_count || 0)
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.log(
      "Owner error:",
      error
    );

    return new Response(
      JSON.stringify({
        error: "Server error"
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
