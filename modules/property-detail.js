/**
 * Property.ie detail module for DS-Property-Percolator
 *
 * Captures individual listing pages from property.ie.
 * Triggered when the page contains #searchmoreinfo_summary (detail page marker)
 * and no div.search_result elements (search results page marker).
 *
 * Fields extracted:
 *   id            - Numeric listing ID (string)
 *   url           - Absolute URL of the listing page (tab URL)
 *   address       - Property address from the h1
 *   price         - Price string as displayed (e.g. "€350,000")
 *   bedrooms      - Bedroom count (integer); null if not applicable
 *   bedrooms_max  - Upper bedroom count for new-home ranges; null otherwise
 *   bathrooms     - Bathroom count (integer); null if not applicable
 *   property_type - Type as displayed (e.g. "Apartment For Sale")
 *   listing_type  - One of: "sale", "rent", "new_home", "commercial"
 *   ber_rating    - BER rating string (e.g. "D1", "B2"); null if absent
 *   agent         - Estate agent name; null if absent
 *   description   - Full listing description as plain text
 *   key_features  - Array of key feature bullet strings
 *   photos        - Array of full-size photo URLs from the photo browser
 *   image_url     - First photo URL (primary image)
 *   latitude      - Decimal latitude from inline map data
 *   longitude     - Decimal longitude from inline map data
 */
zeeschuimer.register_module(
  "Property.ie (Detail)",
  "property.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["property.ie"].includes(domain)) {
      return [];
    }

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    // Only fire on individual listing detail pages.
    if (!doc.querySelector("#searchmoreinfo_summary")) return [];
    if (doc.querySelector("div.search_result")) return [];

    // --- ID ---
    // Save-ad elements carry a class like id_s_6321267 (sale), id_r_ (rent),
    // id_n_ (new home), id_c_ (commercial) — same encoding as search results.
    let id = null;
    const saveAdEl = doc.querySelector(
      "[class*='id_s_'],[class*='id_r_'],[class*='id_n_'],[class*='id_c_']"
    );
    if (saveAdEl) {
      for (const cls of saveAdEl.classList) {
        const match = cls.match(/^id_[srnc]_(\d+)$/);
        if (match) { id = match[1]; break; }
      }
    }
    // Fallback: numeric ID is the last path segment of the URL.
    if (!id) {
      const urlMatch = source_platform_url.replace(/\/$/, "").match(/\/(\d+)$/);
      if (urlMatch) id = urlMatch[1];
    }
    if (!id) return [];

    // --- Address ---
    const address = doc.querySelector("h1")?.textContent.trim() || null;

    // --- Price ---
    const price = doc.querySelector("#searchmoreinfo_summary h2")?.textContent.trim() || null;

    // --- Listing type (from URL path, same logic as search module) ---
    let listing_type = null;
    if (source_platform_url.includes("/property-for-sale/")) listing_type = "sale";
    else if (source_platform_url.includes("/property-to-let/")) listing_type = "rent";
    else if (source_platform_url.includes("/new-homes/")) listing_type = "new_home";
    else if (source_platform_url.includes("/commercial-property/")) listing_type = "commercial";

    // --- Beds, baths, property type ---
    // The summary div contains plain-text lines separated by <br> tags:
    //   "Apartment For Sale"
    //   "2 Bedrooms, 1 Bathroom, Apartment For Sale"
    let bedrooms = null, bedrooms_max = null, bathrooms = null, property_type = null;
    const summaryDiv = doc.querySelector("#searchmoreinfo_summary");
    if (summaryDiv) {
      const clone = summaryDiv.cloneNode(true);
      clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
      clone.querySelectorAll("h2, div, p").forEach(el => el.remove());
      const lines = clone.textContent.split("\n").map(s => s.trim()).filter(Boolean);

      const detail_line = lines.find(l => /\d+\s+(bedroom|bathroom)/i.test(l));
      const type_line = lines.find(l => !/\d+\s+(bedroom|bathroom)/i.test(l));

      if (detail_line) {
        const bedsMatch = detail_line.match(/(\d+)\s*(?:-\s*(\d+)\s*)?bedrooms?/i);
        const bathsMatch = detail_line.match(/(\d+)\s+bathrooms?/i);
        if (bedsMatch) {
          bedrooms = parseInt(bedsMatch[1]);
          if (bedsMatch[2]) bedrooms_max = parseInt(bedsMatch[2]);
        }
        if (bathsMatch) bathrooms = parseInt(bathsMatch[1]);
      }
      property_type = type_line || null;
    }

    // --- BER rating ---
    let ber_rating = null;
    const berEl = doc.querySelector(".ber-top img");
    if (berEl) {
      const berMatch = (berEl.getAttribute("src") || "").match(/\/ber_([^.]+)\.png/i);
      if (berMatch) ber_rating = berMatch[1];
    }

    // --- Agent name (first line of the selling agent block) ---
    let agent = null;
    const agentP = doc.querySelector("#searchmoreinfo_sellingagent p");
    if (agentP) {
      const clone = agentP.cloneNode(true);
      clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
      agent = clone.textContent.trim().split("\n")[0].trim() || null;
    }

    // --- Full description text ---
    // Clone and strip: heading, ad island div, and trailing <p> elements
    // (BER details and "last updated" paragraphs), then convert <br> to newlines.
    let description = null;
    const descDiv = doc.querySelector("#searchmoreinfo_description");
    if (descDiv) {
      const clone = descDiv.cloneNode(true);
      clone.querySelector("h2")?.remove();
      clone.querySelector("#searchmoreinfo_island")?.remove();
      clone.querySelectorAll("p").forEach(p => p.remove());
      clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
      const text = clone.textContent.trim().replace(/\n{3,}/g, "\n\n");
      description = text || null;
    }

    // --- Key features ---
    let key_features = [];
    const featuresDiv = doc.querySelector("#searchmoreinfo_features");
    if (featuresDiv) {
      const clone = featuresDiv.cloneNode(true);
      clone.querySelector("h2")?.remove();
      clone.querySelectorAll("span.red_arrow").forEach(s => s.remove());
      clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
      key_features = clone.textContent
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);
    }

    // --- Photos (full-size from photo browser carousel; src set directly) ---
    const photos = Array.from(
      doc.querySelectorAll("#pbxl_carousel li.pbxl_carousel_item img")
    ).map(img => img.getAttribute("src")).filter(Boolean);

    const image_url = photos.length > 0
      ? photos[0]
      : (doc.querySelector("#searchmoreinfo_photos span.p1 img")?.getAttribute("src") || null);

    // --- Coordinates from inline mapData script block ---
    let latitude = null, longitude = null;
    for (const script of doc.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      if (!text.includes("mapData")) continue;
      const latMatch = text.match(/latitude\s*:\s*([-\d.]+)/);
      const lonMatch = text.match(/longitude\s*:\s*([-\d.]+)/);
      if (latMatch && lonMatch) {
        latitude = parseFloat(latMatch[1]);
        longitude = parseFloat(lonMatch[1]);
        break;
      }
    }

    return [{
      id,
      url: source_platform_url,
      address,
      price,
      bedrooms,
      bedrooms_max,
      bathrooms,
      property_type,
      listing_type,
      ber_rating,
      agent,
      description,
      key_features,
      photos,
      image_url,
      latitude,
      longitude,
    }];
  },
  null,
  "property.ie-detail"
);
