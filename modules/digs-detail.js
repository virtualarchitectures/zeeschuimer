zeeschuimer.register_module(
  "Digs.ie (Detail)",
  "digs.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");
    if (!["digs.ie"].includes(domain)) return [];

    let path;
    try {
      path = new URL(source_url).pathname;
    } catch (e) {
      return [];
    }
    // Search results are at /properties exactly; detail pages are /properties/{slug}
    if (!path.startsWith("/properties/")) return [];

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    const postItem = doc.querySelector("span.postItem[data-postid]");
    const id = postItem ? postItem.getAttribute("data-postid") : null;
    if (!id) return [];

    // --- JSON-LD (Offer schema) ---
    let jsonld = null;
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
      try {
        const parsed = JSON.parse(el.textContent);
        if (parsed["@type"] === "Offer") jsonld = parsed;
      } catch (e) {}
    });

    // Title
    const titleEl = doc.querySelector("#post-content h1");
    const title = titleEl
      ? titleEl.textContent.trim()
      : jsonld
      ? jsonld.name
      : null;

    // Address: strip the map-marker icon from its containing span
    let address = null;
    const markerIcon = doc.querySelector("i.fa-map-marker");
    if (markerIcon) {
      const spanEl = markerIcon.closest("span.inline-block");
      if (spanEl) {
        const clone = spanEl.cloneNode(true);
        clone.querySelectorAll("i").forEach((i) => i.remove());
        address = clone.textContent.trim().replace(/\s+/g, " ") || null;
      }
    }

    // Beds and Baths: value is the text node after the <b> label within each span
    function extract_count(iconClass) {
      const icon = doc.querySelector(`i.${iconClass}`);
      if (!icon) return null;
      const spanEl = icon.closest("span.inline-block");
      if (!spanEl) return null;
      const clone = spanEl.cloneNode(true);
      clone.querySelectorAll("b").forEach((b) => b.remove());
      const text = clone.textContent.trim();
      const num = parseInt(text);
      return !isNaN(num) ? num : null;
    }
    const bedrooms = extract_count("fa-bed");
    const bathrooms = extract_count("fa-bath");

    // Price
    const priceAmountEl = doc.querySelector("div.bg-primary span.h4.nomargin.bold");
    const price_raw = priceAmountEl ? priceAmountEl.textContent.trim() : null;
    const priceLabelEl = doc.querySelector("div.bg-primary span.pull-right.badge");
    const price_label = priceLabelEl ? priceLabelEl.textContent.trim() : null;
    const price = jsonld ? jsonld.price : null;
    const price_currency = jsonld ? (jsonld.priceCurrency || "EUR") : "EUR";

    // Photos: full-size from royalSlider data-rsbigimg attributes
    const photos = Array.from(
      doc.querySelectorAll("#gallery-1 a.rsImg[data-rsbigimg]")
    )
      .map((a) => {
        const src = a.getAttribute("data-rsbigimg");
        if (!src) return null;
        return src.startsWith("http") ? src : "https://www.digs.ie" + src;
      })
      .filter(Boolean);
    const image_url =
      photos.length > 0 ? photos[0] : jsonld?.itemOffered?.image || null;

    // Date posted
    const dateEl = doc.querySelector("span.posted-by-snippet-date");
    const date_posted = dateEl ? dateEl.textContent.trim() : null;

    // Poster info
    const posterLinkEl = doc.querySelector("h4.inline-block.bold a");
    const posted_by = posterLinkEl ? posterLinkEl.textContent.trim() : null;

    const posterTypeEl = doc.querySelector("span.snapshot-member-top-category");
    const poster_type = posterTypeEl
      ? posterTypeEl.textContent.trim().replace(/\s+/g, " ")
      : null;

    const memberSinceEl = doc.querySelector("small.snapshot-member-join-date");
    const member_since = memberSinceEl
      ? memberSinceEl.textContent
          .trim()
          .replace(/^Member since\s*/i, "")
          .trim()
      : null;

    // Description: join <p> text, replacing &nbsp; with spaces
    const descEl = doc.querySelector("div.the-post-description");
    let description = null;
    if (descEl) {
      description =
        Array.from(descEl.querySelectorAll("p"))
          .map((p) => p.textContent.replace(/ /g, " ").trim())
          .filter(Boolean)
          .join("\n\n") || null;
    }

    return [
      {
        id,
        url: source_platform_url,
        title,
        address,
        price,
        price_currency,
        price_raw,
        price_label,
        bedrooms,
        bathrooms,
        description,
        photos,
        image_url,
        date_posted,
        posted_by,
        poster_type,
        member_since,
      },
    ];
  },
  null,
  "digs.ie-detail"
);
