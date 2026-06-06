/**
 * Property.ie module for DS-Property-Percolator
 *
 * Captures property listings from property.ie search results pages.
 * Supports four listing types, each under a distinct URL path:
 *   - Residential for sale:  /property-for-sale/
 *   - Residential to let:    /property-to-let/
 *   - New homes:             /new-homes/
 *   - Commercial:            /commercial-property/
 *
 * The module parses the server-rendered HTML of search results pages.
 * Individual listing pages are not captured.
 *
 * Fields extracted per listing:
 *   id             - Numeric listing ID (string)
 *   url            - Absolute URL of the listing page
 *   address        - Property address
 *   price          - Price string as displayed (e.g. "€350,000", "Rent Negotiable")
 *   bedrooms       - Bedroom count, or minimum of a range for new homes (integer)
 *   bedrooms_max   - Maximum of a bedroom range for new homes listings; null otherwise
 *   bathrooms      - Bathroom count (integer); null for new homes and commercial
 *   furnished      - Furnishing status string; rental listings only
 *   floor_area     - Floor area string (e.g. "1,200 sq. feet (111 sq. metres)"); commercial only
 *   property_type  - Property type as displayed (e.g. "Semi-Detached House", "Office To Let")
 *   available_from - Available-from date string; rental listings only
 *   description    - Truncated listing description paragraph
 *   image_url      - Absolute URL of the listing thumbnail image; null if none
 *   ber_rating     - BER rating string (e.g. "A2", "C1", "Exempt"); null if not shown
 *   agent          - Estate agent name; null if not shown
 *   listing_type   - One of: "sale", "rent", "new_home", "commercial"
 */
zeeschuimer.register_module(
  "Property.ie",
  "property.ie",
  function (response, source_platform_url, source_url) {
    // Verify the tab URL belongs to property.ie before parsing anything.
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

    const items = [];

    // Each search result is contained in a div.search_result card.
    doc.querySelectorAll("div.search_result").forEach((card) => {

      // --- Listing ID ---
      // The save-ad span carries a class encoding the listing ID and type prefix:
      //   id_s_XXXXXXX  (for sale)
      //   id_r_XXXXXXX  (to let / rental)
      //   id_n_XXXXXXX  (new homes)
      //   id_c_XXXXXXX  (commercial)
      let id = null;
      const saveAdEl = card.querySelector("span.sresult_savead");
      if (saveAdEl) {
        for (const cls of saveAdEl.classList) {
          const match = cls.match(/^id_[srnc]_(\d+)$/);
          if (match) {
            id = match[1];
            break;
          }
        }
      }

      // --- Address link ---
      const linkEl = card.querySelector("div.sresult_address h2 a");
      const href = linkEl ? linkEl.getAttribute("href") : null;

      // Fallback: extract the numeric ID from the listing URL path if the
      // save-ad span was absent or did not carry a recognised class.
      if (!id && href) {
        const urlMatch = href.match(/\/(\d+)\/?$/);
        if (urlMatch) id = urlMatch[1];
      }

      // Skip cards where no ID could be determined.
      if (!id) return;

      // Strip the result-position number that property.ie injects into the
      // h2 text (e.g. "1. 12 Main Street" → "12 Main Street").
      const address = linkEl
        ? linkEl.textContent.trim().replace(/^\d+\.\s*/, "")
        : null;

      // Resolve relative hrefs to absolute URLs.
      const url = href
        ? href.startsWith("/") ? "https://www.property.ie" + href : href
        : null;

      // --- Price ---
      // Displayed as-is; can be "€350,000", "€2,500  monthly",
      // "€69,200  yearly (€5,767 per month)", "Rent Negotiable", "Price on Application", etc.
      const priceEl = card.querySelector("div.sresult_description h3");
      const price = priceEl ? priceEl.textContent.trim() : null;

      // --- Property details (h4) ---
      // The h4 format varies by listing type:
      //   Sale:       "N Bedrooms, N Bathrooms, Property Type"
      //   Rental:     "N bedroom[s][ (details)], N bathroom[s][, furnishing] Type to Rent"
      //   Studio:     "Studio[ (details)] Studio apartment to Rent"
      //   New homes:  "N[ - M] Bedrooms[ - ] For Sale"  (bedroom range possible)
      //   Commercial: "N,NNN sq. feet (N sq. metres) Property Type [To Let/For Sale]"
      const detailsEl = card.querySelector("div.sresult_description h4");
      const detailsText = detailsEl ? detailsEl.textContent.trim() : "";
      let bedrooms = null;
      let bedrooms_max = null;
      let bathrooms = null;
      let furnished = null;
      let floor_area = null;
      let property_type = null;

      // Bedroom count; new homes may express a range ("3 - 5 Bedrooms").
      const bedsMatch = detailsText.match(/(\d+)\s*(?:-\s*(\d+)\s*)?bedrooms?/i);
      if (bedsMatch) {
        bedrooms = parseInt(bedsMatch[1]);
        if (bedsMatch[2]) bedrooms_max = parseInt(bedsMatch[2]);
      }

      const bathsMatch = detailsText.match(/(\d+)\s+bathrooms?/i);
      if (bathsMatch) bathrooms = parseInt(bathsMatch[1]);

      // Furnishing status appears on some rental listings.
      const furnishedMatch = detailsText.match(
        /\b(furnished\s+or\s+unfurnished|unfurnished|furnished)\b/i
      );
      if (furnishedMatch) furnished = furnishedMatch[1].toLowerCase().replace(/\s+/g, " ");

      // Floor area appears on commercial listings in one of two forms:
      //   "N,NNN sq. feet (N,NNN sq. metres)"
      //   "N.NN acres (N.NN hectares)"
      const floorAreaMatch = detailsText.match(
        /([\d,.]+\s+sq\.\s+feet\s+\([^)]+\)|[\d.]+\s+acres?\s+\([^)]+\))/i
      );
      if (floorAreaMatch) floor_area = floorAreaMatch[1].trim();

      // Derive property_type by stripping all structured tokens from the h4,
      // leaving only the type description at the end of the string.
      let typeStr = detailsText
        .replace(/[\d,.]+\s+sq\.\s+feet\s+\([^)]+\)\s*/gi, "")
        .replace(/[\d.]+\s+acres?\s+\([^)]+\)\s*/gi, "")
        .replace(/\d+\s*(?:-\s*\d+\s*)?bedrooms?\s*(\([^)]*\))?\s*[-,]?\s*/gi, "")
        .replace(/\d+\s+bathrooms?\s*(\([^)]*\))?\s*[-,]?\s*/gi, "")
        .replace(/\b(furnished\s+or\s+unfurnished|unfurnished|furnished)\b\s*/gi, "")
        .replace(/^Studio\s*(\([^)]*\))?\s*/i, "")
        .replace(/^[,\s]+|[,\s]+$/g, "")
        .trim();
      if (typeStr) property_type = typeStr;

      // --- Available-from date (rental listings only) ---
      // Injected as a span inside the description paragraph; pulled out separately
      // so it does not contaminate the description text.
      const availableEl = card.querySelector("span.sresult_available_from");
      let available_from = null;
      if (availableEl) {
        available_from = availableEl.textContent
          .replace(/-\s*$/, "")
          .trim() || null;
      }

      // --- Description ---
      // The description paragraph may contain an sresult_available_from span on
      // rental listings; clone and strip it before extracting the text content.
      const descEl = card.querySelector("div.sresult_description p");
      let description = null;
      if (descEl) {
        const descClone = descEl.cloneNode(true);
        const avail = descClone.querySelector("span.sresult_available_from");
        if (avail) avail.remove();
        description = descClone.textContent.trim() || null;
      }

      // --- Listing image ---
      // Images are lazy-loaded: the real URL is in data-original while src holds
      // a placeholder gif. Prefer data-original; treat the no_image placeholder
      // path as absent so image_url is null rather than a broken placeholder.
      let image_url = null;
      const imgEl = card.querySelector("img.thumb");
      if (imgEl) {
        const candidate =
          imgEl.getAttribute("data-original") || imgEl.getAttribute("src");
        if (candidate && !candidate.includes("/fronts/pie/no_image")) {
          image_url = candidate;
        }
      }

      // --- BER rating ---
      // Encoded in the filename of the BER badge image, e.g. "ber_C1.png" → "C1".
      // Some listings show a <span>&nbsp;</span> placeholder instead of an <img>
      // when no BER data is available; those return null here.
      let ber_rating = null;
      const berEl = card.querySelector("div.ber-search-results img");
      if (berEl) {
        const berMatch = (berEl.getAttribute("src") || "").match(
          /ber_([^.]+)\.png/i
        );
        if (berMatch) ber_rating = berMatch[1];
      }

      // --- Agent ---
      // The agent logo alt text follows the pattern "Agency Name Logo"; strip the
      // trailing " Logo" suffix to get the agent name alone.
      const agentEl = card.querySelector("img.agent_logo");
      const agent = agentEl
        ? agentEl.getAttribute("alt").replace(/\s*Logo\s*$/i, "").trim()
        : null;

      // --- Listing type ---
      // Derived from the tab URL path since the card HTML itself does not contain
      // a structured listing-type field.
      let listing_type = null;
      if (source_platform_url.includes("/property-for-sale/")) {
        listing_type = "sale";
      } else if (source_platform_url.includes("/property-to-let/")) {
        listing_type = "rent";
      } else if (source_platform_url.includes("/new-homes/")) {
        listing_type = "new_home";
      } else if (source_platform_url.includes("/commercial-property/")) {
        listing_type = "commercial";
      }

      items.push({
        id,
        url,
        address,
        price,
        bedrooms,
        bedrooms_max,
        bathrooms,
        furnished,
        floor_area,
        property_type,
        available_from,
        description,
        image_url,
        ber_rating,
        agent,
        listing_type,
      });
    });

    return items;
  }
);
