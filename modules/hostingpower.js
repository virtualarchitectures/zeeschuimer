zeeschuimer.register_module(
  "HostingPower.ie",
  "hostingpower.ie",
  function (response, source_platform_url, source_url) {
    let domain = source_platform_url
      .split("/")[2]
      .toLowerCase()
      .replace(/^www\./, "");

    if (!["hostingpower.ie"].includes(domain)) {
      return [];
    }

    let request_url;
    try {
      request_url = new URL(source_url);
    } catch (e) {
      return [];
    }

    const path = request_url.pathname;

    // Handle both the main search page and the load-more AJAX endpoint
    if (path !== "/guest/search" && path !== "/guest/loadMoreRooms") {
      return [];
    }

    let doc;
    try {
      doc = new DOMParser().parseFromString(response, "text/html");
    } catch (e) {
      return [];
    }

    const items = [];

    doc.querySelectorAll("div.rooms-search-inner-wrap").forEach((card) => {
      const linkEl = card.querySelector("div.rooms-content-wrap a[href]");
      if (!linkEl) return;

      const idMatch = linkEl.getAttribute("href").match(/\/details\/(\d+)/);
      if (!idMatch) return;

      const id = idMatch[1];
      const url = "https://hostingpower.ie/details/" + id;

      // Room type and optional bathroom type
      const typeEl = card.querySelector("div.rooms-content-wrap p.fw-200");
      let room_type = null;
      let bathroom_type = null;
      if (typeEl) {
        const bathEl = typeEl.querySelector("span.text-muted");
        if (bathEl) {
          bathroom_type = bathEl.textContent.trim();
          const clone = typeEl.cloneNode(true);
          clone.querySelector("span.text-muted").remove();
          room_type = clone.textContent.replace(/\s+with\s*$/, "").trim();
        } else {
          room_type = typeEl.textContent.trim();
        }
      }

      // Neighbourhood, district, room label from <h6>
      const h6El = card.querySelector("div.rooms-content-wrap h6.fw-300");
      let neighbourhood = null;
      let district = null;
      let room_label = null;
      if (h6El) {
        const strongEl = h6El.querySelector("strong");
        district = strongEl ? strongEl.textContent.trim() : null;

        let textBefore = "";
        let textAfter = "";
        let foundStrong = false;
        for (const node of h6El.childNodes) {
          if (node.nodeType === 3) {
            if (!foundStrong) textBefore += node.textContent;
            else textAfter += node.textContent;
          } else if (node.nodeName === "STRONG") {
            foundStrong = true;
          }
        }

        neighbourhood = textBefore.trim() || null;
        const labelMatch = textAfter.match(/\(([^)]+)\)/);
        room_label = labelMatch ? labelMatch[1].trim() : null;
      }

      // Price
      const priceEl = card.querySelector("p.rent-box");
      const price = priceEl ? priceEl.textContent.trim() : null;

      // Optional star rating
      const ratingEl = card.querySelector("span.room-rating-overall");
      let rating = null;
      if (ratingEl) {
        const clone = ratingEl.cloneNode(true);
        const icon = clone.querySelector("i");
        if (icon) icon.remove();
        rating = clone.textContent.trim() || null;
      }

      // Transport types from icon titles (excluding guest count)
      const transport = [];
      card.querySelectorAll("div.room-icon-wrap i[title]").forEach((icon) => {
        const title = icon.getAttribute("title");
        if (title && !/guest/i.test(title)) {
          transport.push(title);
        }
      });

      // Guest count
      const guestIcon = card.querySelector("div.room-icon-wrap i.fa-user[title]");
      const guest_count = guestIcon ? guestIcon.getAttribute("title") : null;

      const imgEl = card.querySelector("img[src*='hosting-pictures.s3']");
      const image_url = imgEl ? imgEl.getAttribute("src") : null;

      items.push({
        id,
        url,
        room_type,
        bathroom_type,
        neighbourhood,
        district,
        room_label,
        price,
        rating,
        transport,
        guest_count,
        image_url,
      });
    });

    return items;
  }
);
