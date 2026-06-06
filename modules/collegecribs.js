zeeschuimer.register_module(
  "CollegeCribs",
  "collegecribs.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["collegecribs.ie"].includes(domain)) {
      return [];
    }

    let request_url;
    try {
      request_url = new URL(source_url);
    } catch (e) {
      return [];
    }

    const request_domain = request_url.hostname.toLowerCase();
    const path = request_url.pathname;

    // Handle JSON API responses (client-side pagination via Nuxt router)
    if (
      request_domain === "beta-api.collegecribs.ie" &&
      path === "/api/v1/listings"
    ) {
      let data;
      try {
        data = JSON.parse(response);
      } catch (e) {
        return [];
      }

      return [...(data.regular || []), ...(data.in_spotlight || [])];
    }

    // Handle SSR HTML responses (direct page loads)
    if (path !== "/listings") {
      return [];
    }

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    // Extract ref_number -> slug mapping from the embedded window.__NUXT__ script.
    // The Nuxt SSR payload compresses repeated values into function arguments,
    // so we can't JSON.parse it — instead we match ref_number/slug pairs directly.
    const slugMap = {};
    doc.querySelectorAll("script:not([src])").forEach((scriptEl) => {
      const text = scriptEl.textContent;
      if (!text.includes("window.__NUXT__")) return;
      // Negative lookahead stops the match before the next ref_number field,
      // ensuring we pair each ref_number with its own listing's slug.
      const pattern =
        /ref_number:"(\d+)"(?:(?!ref_number:)[\s\S])*?slug:"([a-z0-9-]+)"/g;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        slugMap[m[1]] = m[2];
      }
    });

    const items = [];

    // Matches both spotlight sidebar cards and paginated regular listing cards.
    doc.querySelectorAll("div.c-teaser.c-teaser--alt").forEach((card) => {
      const refEl = card.querySelector("h5.c-teaser__ref span.t-head__name");
      if (!refEl) return;

      const refMatch = refEl.textContent.match(/Ref:\s*(\d+)/);
      if (!refMatch) return;
      const ref_number = refMatch[1];

      const titleEl = card.querySelector("h3.t-head--normal span.t-head__name");
      const title = titleEl ? titleEl.textContent.trim() : null;

      const addressEl = card.querySelector("address");
      const address = addressEl ? addressEl.textContent.trim() : null;

      const distanceEl = card.querySelector("div.t-content.t-content--alt");
      const distance = distanceEl ? distanceEl.textContent.trim() : null;

      const updatedEl = card.querySelector(
        "h4.t-head--small span.t-head__name strong"
      );
      const updated = updatedEl ? updatedEl.textContent.trim() : null;

      let property_type = null;
      let is_premium = false;
      card.querySelectorAll("span.c-label--alt.u-text-uppercase").forEach((el) => {
        if (el.classList.contains("c-label--th-1")) {
          is_premium = true;
        } else {
          property_type = el.textContent.trim();
        }
      });

      const bedrooms = [];
      card
        .querySelectorAll("ul.c-features-list li.c-features-list__item")
        .forEach((room) => {
          const typeSpan = room.querySelector(
            ".l-grid__item:first-child .c-label--comp"
          );
          let room_type = null;
          if (typeSpan) {
            const clone = typeSpan.cloneNode(true);
            const ico = clone.querySelector(".c-label__ico");
            if (ico) ico.remove();
            room_type = clone.textContent.trim();
          }

          const priceEl = room.querySelector(
            ".l-grid__item:last-child .c-label--comp strong"
          );
          const price = priceEl ? priceEl.textContent.trim() : null;

          const periodEl = room.querySelector(
            ".l-grid__item:last-child .c-label--comp"
          );
          let period = null;
          if (periodEl) {
            period = periodEl.textContent
              .replace(priceEl ? priceEl.textContent : "", "")
              .replace(/[/]/g, "")
              .trim();
          }

          bedrooms.push({ room_type, price, period });
        });

      const slug = slugMap[ref_number] || null;
      const url = slug
        ? "https://www.collegecribs.ie/listings/" + slug
        : null;

      items.push({
        id: ref_number,
        ref_number,
        url,
        title,
        address,
        distance,
        property_type,
        is_premium,
        updated,
        bedrooms,
      });
    });

    return items;
  }
);
