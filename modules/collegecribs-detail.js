zeeschuimer.register_module(
  "CollegeCribs.ie (Detail)",
  "collegecribs.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");
    if (!["collegecribs.ie"].includes(domain)) return [];

    let request_url;
    try {
      request_url = new URL(source_url);
    } catch (e) {
      return [];
    }

    const request_domain = request_url.hostname.toLowerCase().replace(/^www\./, "");
    const path = request_url.pathname;

    // --- API branch: single-listing endpoint fired during Nuxt client-side navigation ---
    // The search module handles /api/v1/listings (no trailing ID); this handles
    // /api/v1/listings/{id} (individual listing fetch).
    if (
      request_domain === "beta-api.collegecribs.ie" &&
      /^\/api\/v1\/listings\/\d+$/.test(path)
    ) {
      let data;
      try {
        data = JSON.parse(response);
      } catch (e) {
        return [];
      }

      const ref_number = data.ref_number || null;
      const item_id = ref_number || (data.id != null ? String(data.id) : null);
      if (!item_id) return [];

      const address_obj = data.address || {};
      const photos = (data.photos || [])
        .map((p) => p?.large?.normal)
        .filter(Boolean);

      return [
        {
          id: item_id,
          ref_number,
          slug: data.slug || null,
          name: data.name || null,
          address: address_obj.full_string || null,
          latitude: address_obj.latitude || null,
          longitude: address_obj.longitude || null,
          accommodation_type:
            data.accomodation_type?.name || data.accomodation_type || null,
          rental_type:
            data.rental_type?.name || data.rental_type || null,
          lowest_deposit: data.lowest_deposit || null,
          available_bedrooms: data.available_bedrooms || null,
          bathrooms: data.bathrooms || null,
          furnished: data.furnished != null ? !!data.furnished : null,
          available_from: data.available_from || null,
          created_at: data.created_at || null,
          updated_at: data.updated_at || null,
          description: data.description || null,
          amenities: (data.amenities || []).map((a) => a.name).filter(Boolean),
          photos,
          image_url: photos.length > 0 ? photos[0] : null,
          bedrooms: data.bedrooms || [],
        },
      ];
    }

    // --- SSR HTML branch: full page reload ---
    // Only handle HTML from the main site, not the API subdomain.
    if (request_domain !== "collegecribs.ie") return [];
    // Search results page is handled by the search module.
    if (path === "/listings") return [];

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    // --- Extract from window.__NUXT__ ---
    // Nuxt SSR deduplicates repeated values into function arguments, so we
    // cannot JSON.parse the payload — instead we use targeted regex on literals.
    let ref_number = null;
    let latitude = null, longitude = null;
    let available_from = null, created_at = null, updated_at = null;
    let photos = [];
    let nuxtHasListing = false;

    doc.querySelectorAll("script:not([src])").forEach((scriptEl) => {
      const text = scriptEl.textContent;
      if (!text.includes("window.__NUXT__")) return;
      if (!text.includes("dataListing:")) return;

      nuxtHasListing = true;

      const refMatch = text.match(/ref_number:"(\d+)"/);
      if (refMatch) ref_number = refMatch[1];

      const latMatch = text.match(/latitude:([-\d.]+)/);
      const lonMatch = text.match(/longitude:([-\d.]+)/);
      if (latMatch) latitude = parseFloat(latMatch[1]);
      if (lonMatch) longitude = parseFloat(lonMatch[1]);

      const afMatch = text.match(/available_from:"([^"]+)"/);
      if (afMatch) available_from = afMatch[1];

      const caMatch = text.match(/created_at:"([^"]+)"/);
      if (caMatch) created_at = caMatch[1];

      const uaMatch = text.match(/updated_at:"([^"]+)"/);
      if (uaMatch) updated_at = uaMatch[1];

      // Photos: extract literal normal-resolution URLs. The first photo uses a
      // deduplication variable (same as the og:image meta tag), subsequent ones
      // are literal strings.
      for (const m of text.matchAll(/large:\{normal:"(https[^"]+)"/g)) {
        photos.push(m[1]);
      }
    });

    if (!nuxtHasListing || !ref_number) return [];

    // The first photo URL appears as a deduplication variable in __NUXT__ but
    // is the same value as the og:image meta tag.
    const ogImage = doc
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content");
    if (ogImage && !photos.includes(ogImage)) {
      photos.unshift(ogImage);
    }

    // --- DOM extraction ---
    const name =
      doc
        .querySelector("h1.l-listing__title span.t-head__name")
        ?.textContent.trim() || null;

    const slug =
      source_platform_url.replace(/\/$/, "").split("/").pop() || null;

    // Header labels: "Available: now", "Ref: 71437", "Updated: 12th January 2026"
    let updated_label = null, availability_label = null;
    doc.querySelectorAll("span.c-label").forEach((el) => {
      const text = el.textContent;
      if (text.includes("Updated:")) {
        updated_label = text.replace(/.*Updated:\s*/s, "").trim();
      } else if (text.includes("Available:")) {
        availability_label = text.replace(/.*Available:\s*/s, "").trim();
      }
    });

    // Address element (separate from the dl.c-detalis "Address" row which
    // also contains a "View on map" button)
    const address = doc.querySelector("address")?.textContent.trim() || null;

    // Listing details from dl.c-detalis key/value pairs
    const details = {};
    doc.querySelectorAll("dl.c-detalis").forEach((dl) => {
      const dt = dl.querySelector("dt")?.textContent.trim();
      const dd = dl.querySelector("dd");
      if (!dt || !dd) return;
      // "Available bedrooms" has its count in a div.t-content to exclude the
      // "View bedrooms" button text; all others are plain dd text.
      const valueEl = dd.querySelector("div.t-content") || dd;
      details[dt] = valueEl.textContent.trim();
    });

    const accommodation_type = details["Accommodation type"] || null;
    const deposit = details["Deposit"] || null;
    const rental_type = details["Rental type"] || null;
    const available_bedrooms = details["Available bedrooms"]
      ? parseInt(details["Available bedrooms"]) || null
      : null;
    const bathrooms = details["Bathrooms"]
      ? parseInt(details["Bathrooms"]) || null
      : null;
    const furnished =
      details["Furnished"] === "Yes"
        ? true
        : details["Furnished"] === "No"
        ? false
        : null;

    // Full description text: find the box whose h2 says "Description"
    let description = null;
    for (const h2 of doc.querySelectorAll("h2 span.t-head__name")) {
      if (h2.textContent.trim() !== "Description") continue;
      const box = h2.closest(".l-listing__box--shadow");
      if (!box) break;
      const tc = box.querySelector("div.t-content");
      if (!tc) break;
      description =
        Array.from(tc.querySelectorAll("p"))
          .map((p) => p.textContent.trim())
          .filter(Boolean)
          .join("\n\n") || null;
      break;
    }

    return [
      {
        id: ref_number,
        ref_number,
        slug,
        name,
        address,
        latitude,
        longitude,
        accommodation_type,
        rental_type,
        deposit,
        available_bedrooms,
        bathrooms,
        furnished,
        availability: availability_label,
        available_from,
        updated_label,
        created_at,
        updated_at,
        description,
        photos,
        image_url: photos.length > 0 ? photos[0] : null,
      },
    ];
  },
  null,
  "collegecribs.ie-detail"
);
